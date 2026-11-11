#include "../rover/rover_node_impl.hpp"

namespace rover
{
namespace
{
double seconds(const builtin_interfaces::msg::Duration & duration)
{
  return static_cast<double>(duration.sec) + static_cast<double>(duration.nanosec) / 1e9;
}
}  // namespace

rclcpp_action::GoalResponse RoverNode::handle_goal(const rclcpp_action::GoalUUID &, std::shared_ptr<const FollowJointTrajectory::Goal> goal)
{
  return goal->trajectory.joint_names.empty() || goal->trajectory.points.empty() ?
    rclcpp_action::GoalResponse::REJECT : rclcpp_action::GoalResponse::ACCEPT_AND_EXECUTE;
}
rclcpp_action::CancelResponse RoverNode::handle_cancel(const std::shared_ptr<GoalHandleTrajectory>)
{
  return rclcpp_action::CancelResponse::ACCEPT;
}
void RoverNode::handle_accepted(const std::shared_ptr<GoalHandleTrajectory> goal_handle)
{
  for (auto it = trajectory_workers_.begin(); it != trajectory_workers_.end();) {
    if (it->finished->load()) {
      it->thread.join();
      it = trajectory_workers_.erase(it);
    } else {
      ++it;
    }
  }
  auto finished = std::make_shared<std::atomic<bool>>(false);
  trajectory_workers_.push_back({std::thread([this, goal_handle, finished]() {
    try {
      execute_trajectory(goal_handle);
    } catch (const std::exception & error) {
      if (rclcpp::ok(get_node_base_interface()->get_context()) && !stopping_) {
        RCLCPP_ERROR(get_logger(), "Trajectory execution failed: %s", error.what());
      }
    }
    finished->store(true);
  }), finished});
}

RoverNode::~RoverNode()
{
  stopping_ = true;
  for (auto & worker : trajectory_workers_) {
    if (worker.thread.joinable()) worker.thread.join();
  }
}

void RoverNode::abort(const std::shared_ptr<GoalHandleTrajectory> & goal_handle, int32_t code, const std::string & message)
{
  auto result = std::make_shared<FollowJointTrajectory::Result>();
  result->error_code = code;
  result->error_string = message;
  goal_handle->abort(result);
}

void RoverNode::execute_trajectory(const std::shared_ptr<GoalHandleTrajectory> & goal_handle)
{
  std::lock_guard<std::mutex> execution_lock(trajectory_mutex_);
  if (stopping_ || !rclcpp::ok(get_node_base_interface()->get_context())) return;
  const auto trajectory = goal_handle->get_goal()->trajectory;
  const auto names = trajectory.joint_names;
  const std::set<std::string> name_set(names.begin(), names.end());
  const bool partial = std::all_of(name_set.begin(), name_set.end(), [](const std::string & name) { return kProximal.count(name) > 0; });
  const bool full = name_set == kAllJoints;
  if (name_set.size() != names.size() || !(partial || full) || (orientation_locked_ && !full)) {
    abort(goal_handle, FollowJointTrajectory::Result::INVALID_JOINTS,
      "The trajectory must contain J1-J3 when orientation is unlocked or all six joints when orientation is locked.");
    return;
  }
  double previous_time = 0.0;
  for (const auto & point : trajectory.points) {
    const auto point_time = seconds(point.time_from_start);
    if (point_time < previous_time || point.positions.size() != names.size()) {
      abort(goal_handle, FollowJointTrajectory::Result::INVALID_GOAL, "The trajectory points have invalid timing or positions."); return;
    }
    for (size_t index = 0; index < names.size(); ++index) {
      const auto limit = kJointLimits.at(names[index]);
      if (!std::isfinite(point.positions[index]) || point.positions[index] < limit.first || point.positions[index] > limit.second) {
        abort(goal_handle, FollowJointTrajectory::Result::INVALID_GOAL, "Trajectory exceeds a joint limit."); return;
      }
    }
    previous_time = point_time;
  }
  if (previous_time <= 0.0) { abort(goal_handle, FollowJointTrajectory::Result::INVALID_GOAL, "The trajectory must have a positive duration."); return; }
  auto result = std::make_shared<FollowJointTrajectory::Result>();
  JointSimulator::JointValues previous_positions;
  {
    std::lock_guard<std::recursive_mutex> joints_lock(joints_mutex_);
    previous_positions = joints_.positions();
  }
  std::vector<double> previous;
  for (const auto & name : names) previous.push_back(previous_positions.at(name));
  const auto stop_joints = [this, &names]() {
    std::lock_guard<std::recursive_mutex> joints_lock(joints_mutex_);
    const auto positions = joints_.positions();
    JointSimulator::JointValues executed_positions;
    for (const auto & name : names) executed_positions[name] = positions.at(name);
    joints_.set_actual_positions(executed_positions);
    publish_joint_state();
  };
  const auto started = std::chrono::steady_clock::now();
  double previous_point = 0.0;
  for (const auto & point : trajectory.points) {
    const auto target_time = seconds(point.time_from_start);
    const auto segment = target_time - previous_point;
    while (true) {
      if (stopping_ || !rclcpp::ok(get_node_base_interface()->get_context())) return;
      if (goal_handle->is_canceling()) { stop_joints(); result->error_code = FollowJointTrajectory::Result::INVALID_GOAL; result->error_string = "The trajectory was cancelled during execution."; goal_handle->canceled(result); return; }
      const auto elapsed = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
      const auto fraction = segment <= 0.0 ? 1.0 : std::clamp((elapsed - previous_point) / segment, 0.0, 1.0);
      JointSimulator::JointValues values, velocities;
      std::vector<double> actual;
      for (size_t index = 0; index < names.size(); ++index) {
        const auto value = previous[index] + (point.positions[index] - previous[index]) * fraction;
        values[names[index]] = value;
        velocities[names[index]] = segment <= 0.0 ? 0.0 : (point.positions[index] - previous[index]) / segment;
        actual.push_back(value);
      }
      {
        std::lock_guard<std::recursive_mutex> joints_lock(joints_mutex_);
        joints_.set_actual_positions(values, velocities);
        publish_joint_state();
      }
      auto feedback = std::make_shared<FollowJointTrajectory::Feedback>();
      feedback->joint_names = names;
      feedback->actual.positions = actual;
      for (const auto & name : names) feedback->actual.velocities.push_back(velocities[name]);
      goal_handle->publish_feedback(feedback);
      if (fraction >= 1.0) break;
      std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    previous_point = target_time;
    previous.assign(point.positions.begin(), point.positions.end());
  }
  if (stopping_ || !rclcpp::ok(get_node_base_interface()->get_context())) return;
  stop_joints();
  result->error_code = FollowJointTrajectory::Result::SUCCESSFUL;
  goal_handle->succeed(result);
}
}  // namespace rover
