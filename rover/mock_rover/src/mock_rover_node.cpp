#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <functional>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include <control_msgs/action/follow_joint_trajectory.hpp>
#include <rclcpp/rclcpp.hpp>
#include <rclcpp_action/rclcpp_action.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <sensor_msgs/msg/joy.hpp>
#include <std_msgs/msg/bool.hpp>
#include <telemetry_interfaces/msg/fma_state.hpp>

#include "mock_rover/joint_simulator.hpp"
#include "mock_rover/mock_rover_node.hpp"

namespace mock_rover
{
namespace
{
using FollowJointTrajectory = control_msgs::action::FollowJointTrajectory;
using GoalHandleTrajectory = rclcpp_action::ServerGoalHandle<FollowJointTrajectory>;
constexpr std::array<const char *, 6> kJointNames{
  "base_joint", "shoulder_joint", "elbow_joint", "yaw_joint", "pitch_joint", "roll_joint"};
const std::set<std::string> kProximal{"base_joint", "shoulder_joint", "elbow_joint"};
const std::set<std::string> kAllJoints(kJointNames.begin(), kJointNames.end());
const JointSimulator::JointLimits kJointLimits{
  {"base_joint", {-3.228859116, 3.228859116}}, {"shoulder_joint", {-0.087266463, 3.228859116}},
  {"elbow_joint", {-0.087266463, 4.799655442}}, {"yaw_joint", {-1.658062789, 3.228859116}},
  {"pitch_joint", {-0.087266463, 3.752457891}}, {"roll_joint", {-3.228859116, 3.228859116}}};

double seconds(const builtin_interfaces::msg::Duration & duration)
{
  return static_cast<double>(duration.sec) + static_cast<double>(duration.nanosec) / 1e9;
}
}  // namespace

class MockRoverNode : public rclcpp::Node
{
public:
  MockRoverNode()
  : Node("mock_rover"), joints_(std::vector<std::string>(kJointNames.begin(), kJointNames.end()), kJointLimits, 1.0)
  {
    declare_parameter<double>("publish_rate_hz", 10.0);
    const auto rate = std::max(get_parameter("publish_rate_hz").as_double(), 1.0);

    joint_state_publisher_ = create_publisher<sensor_msgs::msg::JointState>("/arm/joint_states", 10);

    subscriptions_.push_back(create_subscription<sensor_msgs::msg::JointState>("/arm/joint_commands", 10,
      std::bind(&MockRoverNode::on_joint_command, this, std::placeholders::_1)));
    subscriptions_.push_back(create_subscription<sensor_msgs::msg::Joy>("/arm/joy", 10,
      [this](sensor_msgs::msg::Joy::SharedPtr message) { on_joy(*message, 8, 9); }));
    subscriptions_.push_back(create_subscription<std_msgs::msg::Bool>("/arm/orientation_lock", 10,
      [this](std_msgs::msg::Bool::SharedPtr message) { orientation_locked_ = message->data; }));
    subscriptions_.push_back(create_subscription<telemetry_interfaces::msg::FmaState>("/fma/state",
      rclcpp::QoS(1).reliable().transient_local(),
      [this](telemetry_interfaces::msg::FmaState::SharedPtr message) { arm_mode_ = message->arm.confirmed; }));

    trajectory_server_ = rclcpp_action::create_server<FollowJointTrajectory>(this,
      "/arm_controller/follow_joint_trajectory",
      std::bind(&MockRoverNode::handle_goal, this, std::placeholders::_1, std::placeholders::_2),
      std::bind(&MockRoverNode::handle_cancel, this, std::placeholders::_1),
      std::bind(&MockRoverNode::handle_accepted, this, std::placeholders::_1));
    tick_timer_ = create_wall_timer(std::chrono::duration<double>(1.0 / rate),
      std::bind(&MockRoverNode::tick, this));
    publish_joint_state();
  }

private:

  void on_joint_command(const sensor_msgs::msg::JointState::SharedPtr message)
  {
    if (message->position.empty()) return;
    JointSimulator::JointValues values;
    if (!message->name.empty()) {
      if (message->name.size() != message->position.size()) return;
      for (size_t index = 0; index < message->name.size(); ++index) values[message->name[index]] = message->position[index];
    } else if (message->position.size() == kJointNames.size()) {
      for (size_t index = 0; index < kJointNames.size(); ++index) values[kJointNames[index]] = message->position[index];
    } else return;
    {
      std::lock_guard<std::recursive_mutex> lock(joints_mutex_);
      joints_.set_target_immediately(values);
    }
    publish_joint_state();
  }

  void on_joy(const sensor_msgs::msg::Joy & message, size_t left_trigger, size_t right_trigger)
  {
    if (message.axes.size() <= right_trigger) return;
    for (const auto axis : {message.axes[left_trigger], message.axes[right_trigger]}) {
      if (!std::isfinite(axis) || axis < 0.0 || axis > 1.0) return;
    }
    if (std::any_of(message.buttons.begin(), message.buttons.end(), [](int32_t value) { return value != 0 && value != 1; })) return;
    if (arm_mode_ == "MANUAL") {
      const bool gimbal_held = message.buttons.size() > 4 && message.buttons[4] > 0;
      apply_deltas({{"base_joint", message.axes[0]}, {"shoulder_joint", message.axes[1]},
        {"elbow_joint", gimbal_held ? 0.0 : message.axes[4]}, {"yaw_joint", message.axes[6]},
        {"pitch_joint", message.axes[7]}, {"roll_joint", message.axes[9] - message.axes[8]}}, 0.5);
    } else if (arm_mode_ == "POSITION" && !orientation_locked_) {
      apply_deltas({{"yaw_joint", message.axes[6]}, {"pitch_joint", message.axes[7]},
        {"roll_joint", message.axes[9] - message.axes[8]}}, 0.5);
    }
  }

  void apply_deltas(const JointSimulator::JointValues & deltas, double speed)
  {
    JointSimulator::JointValues targets;
    {
      std::lock_guard<std::recursive_mutex> lock(joints_mutex_);
      const auto current = joints_.positions();
      for (const auto & [name, value] : deltas) if (value != 0.0) targets[name] = current.at(name) + value * speed * 0.02;
      if (targets.empty()) return;
      joints_.set_target_immediately(targets);
    }
    publish_joint_state();
  }

  rclcpp_action::GoalResponse handle_goal(const rclcpp_action::GoalUUID &, std::shared_ptr<const FollowJointTrajectory::Goal> goal)
  {
    return goal->trajectory.joint_names.empty() || goal->trajectory.points.empty() ?
      rclcpp_action::GoalResponse::REJECT : rclcpp_action::GoalResponse::ACCEPT_AND_EXECUTE;
  }
  rclcpp_action::CancelResponse handle_cancel(const std::shared_ptr<GoalHandleTrajectory>)
  {
    return rclcpp_action::CancelResponse::ACCEPT;
  }
  void handle_accepted(const std::shared_ptr<GoalHandleTrajectory> goal_handle)
  {
    std::thread([this, goal_handle]() { execute_trajectory(goal_handle); }).detach();
  }

  void abort(const std::shared_ptr<GoalHandleTrajectory> & goal_handle, int32_t code, const std::string & message)
  {
    auto result = std::make_shared<FollowJointTrajectory::Result>();
    result->error_code = code;
    result->error_string = message;
    goal_handle->abort(result);
  }

  void execute_trajectory(const std::shared_ptr<GoalHandleTrajectory> & goal_handle)
  {
    std::lock_guard<std::mutex> execution_lock(trajectory_mutex_);
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
    std::lock_guard<std::recursive_mutex> joints_lock(joints_mutex_);
    auto previous_positions = joints_.positions();
    std::vector<double> previous;
    for (const auto & name : names) previous.push_back(previous_positions.at(name));
    const auto started = std::chrono::steady_clock::now();
    double previous_point = 0.0;
    for (const auto & point : trajectory.points) {
      const auto target_time = seconds(point.time_from_start);
      const auto segment = target_time - previous_point;
      while (true) {
        if (goal_handle->is_canceling()) { result->error_code = FollowJointTrajectory::Result::INVALID_GOAL; result->error_string = "The trajectory was cancelled during execution."; goal_handle->canceled(result); return; }
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
        joints_.set_actual_positions(values, velocities);
        publish_joint_state();
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
    result->error_code = FollowJointTrajectory::Result::SUCCESSFUL;
    goal_handle->succeed(result);
  }

  void tick()
  {
    publish_joint_state();
  }
  void publish_joint_state()
  {
    std::lock_guard<std::recursive_mutex> lock(joints_mutex_);
    sensor_msgs::msg::JointState message; message.header.stamp = get_clock()->now();
    const auto positions = joints_.positions(); const auto velocities = joints_.velocities();
    for (const auto * name : kJointNames) { message.name.emplace_back(name); message.position.push_back(positions.at(name)); message.velocity.push_back(velocities.at(name)); }
    joint_state_publisher_->publish(message);
  }
  JointSimulator joints_;
  std::recursive_mutex joints_mutex_;
  std::mutex trajectory_mutex_;
  bool orientation_locked_{false};
  std::string arm_mode_;
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr joint_state_publisher_;
  std::vector<rclcpp::SubscriptionBase::SharedPtr> subscriptions_;
  rclcpp_action::Server<FollowJointTrajectory>::SharedPtr trajectory_server_;
  rclcpp::TimerBase::SharedPtr tick_timer_;
};
}  // namespace mock_rover

std::shared_ptr<rclcpp::Node> mock_rover::make_mock_rover_node()
{
  return std::make_shared<MockRoverNode>();
}
