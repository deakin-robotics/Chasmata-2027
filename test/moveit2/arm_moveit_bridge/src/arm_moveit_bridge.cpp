#include <atomic>
#include <array>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cmath>
#include <future>
#include <limits>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

#include <Eigen/Geometry>
#include <control_msgs/action/follow_joint_trajectory.hpp>
#include <geometry_msgs/msg/pose_stamped.hpp>
#include <moveit/move_group_interface/move_group_interface.hpp>
#include <moveit/robot_trajectory/robot_trajectory.hpp>
#include <moveit/trajectory_processing/time_optimal_trajectory_generation.hpp>
#include <moveit_msgs/action/move_group.hpp>
#include <moveit_msgs/msg/constraints.hpp>
#include <moveit_msgs/msg/move_it_error_codes.hpp>
#include <moveit_msgs/msg/motion_plan_request.hpp>
#include <moveit_msgs/msg/joint_constraint.hpp>
#include <moveit_msgs/msg/position_constraint.hpp>
#include <moveit_msgs/msg/orientation_constraint.hpp>
#include <shape_msgs/msg/solid_primitive.hpp>
#include <rclcpp/rclcpp.hpp>
#include <rclcpp_action/rclcpp_action.hpp>
#include <std_msgs/msg/bool.hpp>
#include <std_msgs/msg/string.hpp>

namespace
{
constexpr char TARGET_TOPIC[] = "/arm/target_pose";
constexpr char ORIENTATION_LOCK_TOPIC[] = "/arm/orientation_lock";
constexpr char STATUS_TOPIC[] = "/arm/moveit/status";
constexpr char TRAJECTORY_ACTION[] = "/arm_controller/follow_joint_trajectory";
constexpr char MOVEIT_PLANNING_ACTION[] = "/move_action";
constexpr char PLANNING_GROUP[] = "arm";
constexpr char POSITION_PLANNING_GROUP[] = "position_arm";
constexpr char REFERENCE_FRAME[] = "base_link";
constexpr char END_EFFECTOR_LINK[] = "ee_link";
constexpr char J4_PIVOT_LINK[] = "j4_pivot_link";
constexpr double PIVOT_POSITION_TOLERANCE_METRES = 0.005;
constexpr double VELOCITY_SCALING = 0.5;
constexpr double ACCELERATION_SCALING = 0.5;
constexpr double PI = 3.14159265358979323846;

using FollowJointTrajectory = control_msgs::action::FollowJointTrajectory;
using GoalHandle = rclcpp_action::ClientGoalHandle<FollowJointTrajectory>;
using MoveGroup = moveit_msgs::action::MoveGroup;
using PlanningGoalHandle = rclcpp_action::ClientGoalHandle<MoveGroup>;

double wrapToPi(double angle)
{
  while (angle > PI) angle -= 2.0 * PI;
  while (angle < -PI) angle += 2.0 * PI;
  return angle;
}

struct TargetRequest
{
  geometry_msgs::msg::Pose pose;
  std::uint64_t request_id;
  std::uint64_t generation;
  bool orientation_locked;
};

std::uint64_t requestIdFromMessage(
  const geometry_msgs::msg::PoseStamped & message,
  std::atomic<std::uint64_t> & fallback_sequence)
{
  const auto seconds = message.header.stamp.sec;
  const auto nanoseconds = message.header.stamp.nanosec;
  if (seconds > 0 || nanoseconds > 0) {
    return static_cast<std::uint64_t>(seconds) * 1'000'000'000ULL + nanoseconds;
  }

  return ++fallback_sequence;
}

void publishStatus(
  const rclcpp::Publisher<std_msgs::msg::String>::SharedPtr & publisher,
  std::uint64_t request_id,
  const char * state,
  const std::string & message = {})
{
  std_msgs::msg::String status;
  status.data =
    "{\"request_id\":" + std::to_string(request_id) +
    ",\"state\":\"" + state +
    "\",\"message\":\"" + message + "\"}";
  publisher->publish(status);
}

moveit_msgs::msg::OrientationConstraint orientationConstraint(
  const geometry_msgs::msg::Quaternion & orientation)
{
  moveit_msgs::msg::OrientationConstraint orientation_constraint;
  orientation_constraint.header.frame_id = REFERENCE_FRAME;
  orientation_constraint.link_name = END_EFFECTOR_LINK;
  orientation_constraint.orientation = orientation;
  orientation_constraint.absolute_x_axis_tolerance = 0.02;
  orientation_constraint.absolute_y_axis_tolerance = 0.02;
  orientation_constraint.absolute_z_axis_tolerance = 0.02;
  orientation_constraint.weight = 1.0;
  return orientation_constraint;
}

moveit_msgs::msg::PositionConstraint linkPositionConstraint(
  const std::string & link_name,
  const geometry_msgs::msg::Point & position,
  double tolerance)
{
  moveit_msgs::msg::PositionConstraint position_constraint;
  position_constraint.header.frame_id = REFERENCE_FRAME;
  position_constraint.link_name = link_name;
  position_constraint.weight = 1.0;

  shape_msgs::msg::SolidPrimitive region;
  region.type = shape_msgs::msg::SolidPrimitive::BOX;
  region.dimensions = {
    tolerance * 2.0,
    tolerance * 2.0,
    tolerance * 2.0};

  geometry_msgs::msg::Pose region_pose;
  region_pose.position = position;
  region_pose.orientation.w = 1.0;
  position_constraint.constraint_region.primitives.push_back(region);
  position_constraint.constraint_region.primitive_poses.push_back(region_pose);
  return position_constraint;
}

moveit_msgs::msg::PositionConstraint pivotPositionConstraint(
  const geometry_msgs::msg::Point & position)
{
  return linkPositionConstraint(J4_PIVOT_LINK, position, PIVOT_POSITION_TOLERANCE_METRES);
}

moveit_msgs::msg::JointConstraint jointConstraint(
  const std::string & joint_name,
  double position)
{
  moveit_msgs::msg::JointConstraint constraint;
  constraint.joint_name = joint_name;
  constraint.position = position;
  constraint.tolerance_above = 0.01;
  constraint.tolerance_below = 0.01;
  constraint.weight = 1.0;
  return constraint;
}

moveit_msgs::msg::Constraints targetConstraints(const TargetRequest & request)
{
  moveit_msgs::msg::Constraints constraints;
  constraints.position_constraints.push_back(pivotPositionConstraint(request.pose.position));
  if (request.orientation_locked) {
    constraints.orientation_constraints.push_back(orientationConstraint(request.pose.orientation));
  }

  return constraints;
}
}

int main(int argc, char * argv[])
{
  rclcpp::init(argc, argv);

  const auto node = rclcpp::Node::make_shared("arm_moveit_bridge");
  const auto status_publisher = node->create_publisher<std_msgs::msg::String>(
    STATUS_TOPIC,
    rclcpp::QoS(10));
  const auto trajectory_client = rclcpp_action::create_client<FollowJointTrajectory>(
    node,
    TRAJECTORY_ACTION);
  const auto planning_client = rclcpp_action::create_client<MoveGroup>(
    node,
    MOVEIT_PLANNING_ACTION);

  std::mutex target_mutex;
  std::condition_variable target_condition;
  std::optional<TargetRequest> pending_target;
  std::optional<geometry_msgs::msg::Pose> latest_pose;
  std::atomic<bool> orientation_locked{false};
  std::atomic<std::uint64_t> latest_request_id{0};
  std::atomic<std::uint64_t> latest_generation{0};
  std::atomic<std::uint64_t> fallback_sequence{0};
  bool shutting_down = false;

  std::mutex action_mutex;
  GoalHandle::SharedPtr active_goal;
  std::mutex planning_mutex;
  PlanningGoalHandle::SharedPtr active_planning_goal;

  const auto target_subscription = node->create_subscription<geometry_msgs::msg::PoseStamped>(
    TARGET_TOPIC,
    rclcpp::QoS(10),
    [&](const geometry_msgs::msg::PoseStamped::SharedPtr message) {
      if (!message) return;

      const auto request_id = requestIdFromMessage(*message, fallback_sequence);
      const auto generation = latest_generation.fetch_add(1) + 1;
      {
        std::lock_guard<std::mutex> lock(target_mutex);
        latest_pose = message->pose;
        pending_target = TargetRequest{
          message->pose,
          request_id,
          generation,
          orientation_locked.load()};
        latest_request_id.store(request_id);
      }

      GoalHandle::SharedPtr goal;
      {
        std::lock_guard<std::mutex> lock(action_mutex);
        goal = active_goal;
      }
      if (goal) trajectory_client->async_cancel_goal(goal);

      PlanningGoalHandle::SharedPtr planning_goal;
      {
        std::lock_guard<std::mutex> lock(planning_mutex);
        planning_goal = active_planning_goal;
      }
      if (planning_goal) planning_client->async_cancel_goal(planning_goal);

      target_condition.notify_one();
    });

  (void)target_subscription;

  const auto orientation_lock_subscription = node->create_subscription<std_msgs::msg::Bool>(
    ORIENTATION_LOCK_TOPIC,
    rclcpp::QoS(10),
    [&](const std_msgs::msg::Bool::SharedPtr message) {
      if (!message) return;

      const auto previous_lock = orientation_locked.exchange(message->data);
      if (previous_lock == message->data) {
        return;
      }

      RCLCPP_INFO(
        node->get_logger(),
        "Orientation lock update received: %s",
        message->data ? "LOCKED" : "UNLOCKED");

      {
        std::lock_guard<std::mutex> lock(target_mutex);
        if (latest_pose) {
          const auto generation = latest_generation.fetch_add(1) + 1;
          pending_target = TargetRequest{
            *latest_pose,
            latest_request_id.load(),
            generation,
            message->data};
        } else if (pending_target) {
          pending_target->orientation_locked = message->data;
        }
      }

      GoalHandle::SharedPtr goal;
      {
        std::lock_guard<std::mutex> lock(action_mutex);
        goal = active_goal;
      }
      if (goal) trajectory_client->async_cancel_goal(goal);

      PlanningGoalHandle::SharedPtr planning_goal;
      {
        std::lock_guard<std::mutex> lock(planning_mutex);
        planning_goal = active_planning_goal;
      }
      if (planning_goal) planning_client->async_cancel_goal(planning_goal);
    });

  (void)orientation_lock_subscription;

  rclcpp::executors::MultiThreadedExecutor executor;
  executor.add_node(node);

  std::thread planning_thread([&]() {
    moveit::planning_interface::MoveGroupInterface full_move_group(node, PLANNING_GROUP);
    moveit::planning_interface::MoveGroupInterface position_move_group(
      node,
      POSITION_PLANNING_GROUP);

    for (auto * move_group : {&full_move_group, &position_move_group}) {
      move_group->setPoseReferenceFrame(REFERENCE_FRAME);
      move_group->setMaxVelocityScalingFactor(VELOCITY_SCALING);
      move_group->setMaxAccelerationScalingFactor(ACCELERATION_SCALING);
      move_group->setPlanningTime(5.0);
      move_group->setNumPlanningAttempts(5);
    }

    RCLCPP_INFO(
      node->get_logger(),
      "MoveIt2 planning bridge ready: %s -> %s -> %s",
      TARGET_TOPIC,
      STATUS_TOPIC,
      TRAJECTORY_ACTION);

    auto is_superseded = [&](std::uint64_t generation) {
      return latest_generation.load() > generation;
    };

    auto planWithMoveIt = [&](const moveit_msgs::msg::MotionPlanRequest & motion_request,
        std::uint64_t generation,
        std::uint64_t request_id) -> std::optional<moveit_msgs::msg::RobotTrajectory> {
      if (!planning_client->wait_for_action_server(std::chrono::seconds(2))) {
        RCLCPP_WARN(
          node->get_logger(),
          "Planning request %llu failed: MoveIt2 planning action unavailable",
          static_cast<unsigned long long>(request_id));
        return std::nullopt;
      }

      MoveGroup::Goal planning_goal;
      planning_goal.request = motion_request;
      planning_goal.planning_options.plan_only = true;
      planning_goal.planning_options.replan = false;
      const auto planning_goal_future = planning_client->async_send_goal(planning_goal);

      while (rclcpp::ok() &&
        planning_goal_future.wait_for(std::chrono::milliseconds(50)) != std::future_status::ready)
      {
        // A newer target cancels the planning action once its goal handle exists.
      }

      if (!rclcpp::ok()) return std::nullopt;
      if (planning_goal_future.wait_for(std::chrono::milliseconds(0)) != std::future_status::ready) {
        return std::nullopt;
      }

      const auto planning_goal_handle = planning_goal_future.get();
      if (!planning_goal_handle) {
        return std::nullopt;
      }

      {
        std::lock_guard<std::mutex> lock(planning_mutex);
        active_planning_goal = planning_goal_handle;
      }

      const auto planning_result_future = planning_client->async_get_result(planning_goal_handle);
      bool cancel_requested = false;
      while (rclcpp::ok() &&
        planning_result_future.wait_for(std::chrono::milliseconds(50)) != std::future_status::ready)
      {
        if (is_superseded(generation) && !cancel_requested) {
          planning_client->async_cancel_goal(planning_goal_handle);
          cancel_requested = true;
        }
      }

      {
        std::lock_guard<std::mutex> lock(planning_mutex);
        if (active_planning_goal == planning_goal_handle) active_planning_goal.reset();
      }

      if (!rclcpp::ok() || is_superseded(generation)) return std::nullopt;
      if (planning_result_future.wait_for(std::chrono::milliseconds(0)) != std::future_status::ready) {
        return std::nullopt;
      }

      const auto wrapped_result = planning_result_future.get();
      if (wrapped_result.code != rclcpp_action::ResultCode::SUCCEEDED ||
        !wrapped_result.result ||
        wrapped_result.result->error_code.val != moveit_msgs::msg::MoveItErrorCodes::SUCCESS)
      {
        RCLCPP_WARN(
          node->get_logger(),
          "Planning request %llu failed: MoveIt2 returned error code %d",
          static_cast<unsigned long long>(request_id),
          wrapped_result.result ? wrapped_result.result->error_code.val : -1);
        return std::nullopt;
      }

      return wrapped_result.result->planned_trajectory;
    };

    while (rclcpp::ok()) {
      TargetRequest request;
      {
        std::unique_lock<std::mutex> lock(target_mutex);
        target_condition.wait(lock, [&]() { return shutting_down || pending_target.has_value(); });

        if (shutting_down) return;

        request = *pending_target;
        pending_target.reset();
      }

      publishStatus(status_publisher, request.request_id, "PLANNING");

      if (is_superseded(request.generation)) continue;

      auto & move_group = request.orientation_locked ? full_move_group : position_move_group;
      const auto planning_group = request.orientation_locked
        ? PLANNING_GROUP
        : POSITION_PLANNING_GROUP;

      move_group.clearPoseTargets();
      move_group.clearPathConstraints();
      move_group.setEndEffectorLink(J4_PIVOT_LINK);
      move_group.setStartStateToCurrentState();

      moveit_msgs::msg::MotionPlanRequest motion_request;
      move_group.constructRobotState(motion_request.start_state);
      motion_request.group_name = planning_group;
      motion_request.pipeline_id = "ompl";
      motion_request.num_planning_attempts = 5;
      motion_request.allowed_planning_time = 5.0;
      motion_request.max_velocity_scaling_factor = VELOCITY_SCALING;
      motion_request.max_acceleration_scaling_factor = ACCELERATION_SCALING;

      std::optional<moveit_msgs::msg::RobotTrajectory> planned_trajectory;
      if (!request.orientation_locked) {
        motion_request.goal_constraints.push_back(targetConstraints(request));
        planned_trajectory = planWithMoveIt(motion_request, request.generation, request.request_id);
      } else {
        // MoveIt's KDL solver can solve the position_arm tip, but cannot sample
        // IK for a secondary pivot link inside the full arm group. First ask the
        // position_arm group for the proximal solution, then let the full group
        // plan the wrist joints while constraining the EE orientation.
        moveit_msgs::msg::MotionPlanRequest pivot_request;
        position_move_group.constructRobotState(pivot_request.start_state);
        pivot_request.group_name = POSITION_PLANNING_GROUP;
        pivot_request.pipeline_id = "ompl";
        pivot_request.num_planning_attempts = 5;
        pivot_request.allowed_planning_time = 5.0;
        pivot_request.max_velocity_scaling_factor = VELOCITY_SCALING;
        pivot_request.max_acceleration_scaling_factor = ACCELERATION_SCALING;
        TargetRequest pivot_target = request;
        pivot_target.orientation_locked = false;
        pivot_request.goal_constraints.push_back(targetConstraints(pivot_target));

        const auto pivot_trajectory = planWithMoveIt(
          pivot_request,
          request.generation,
          request.request_id);
        if (!pivot_trajectory) {
          if (is_superseded(request.generation)) continue;
          publishStatus(
            status_publisher,
            request.request_id,
            "FAILED",
            "MoveIt2 could not position the J4 pivot.");
          continue;
        }

        const auto & pivot_joint_names = pivot_trajectory->joint_trajectory.joint_names;
        const auto & pivot_points = pivot_trajectory->joint_trajectory.points;
        const auto & pivot_positions = pivot_points.back().positions;
        moveit_msgs::msg::Constraints locked_goal;
        const auto full_start_state = full_move_group.getCurrentState(2.0);
        if (!full_start_state) {
          publishStatus(
            status_publisher,
            request.request_id,
            "FAILED",
            "MoveIt2 could not read the current joint state.");
          continue;
        }
        moveit::core::RobotState locked_goal_state(*full_start_state);
        for (std::size_t index = 0; index < pivot_joint_names.size(); ++index) {
          if (index >= pivot_positions.size()) continue;
          if (pivot_joint_names[index] == "base_joint" ||
            pivot_joint_names[index] == "shoulder_joint" ||
            pivot_joint_names[index] == "elbow_joint")
          {
            locked_goal_state.setVariablePosition(pivot_joint_names[index], pivot_positions[index]);
          }
        }
        const auto pivot_transform = locked_goal_state.getGlobalLinkTransform(J4_PIVOT_LINK);
        Eigen::Quaterniond target_orientation(
          request.pose.orientation.w,
          request.pose.orientation.x,
          request.pose.orientation.y,
          request.pose.orientation.z);
        target_orientation.normalize();
        const auto relative_wrist_rotation =
          pivot_transform.rotation().transpose() * target_orientation.toRotationMatrix();
        const auto wrist_angles = relative_wrist_rotation.eulerAngles(1, 0, 2);
        const std::array<Eigen::Vector3d, 2> wrist_candidates = {{
          Eigen::Vector3d{
            -wrapToPi(wrist_angles[0]),
            wrapToPi(wrist_angles[1]),
            wrapToPi(wrist_angles[2])},
          Eigen::Vector3d{
            -wrapToPi(wrist_angles[0] + PI),
            wrapToPi(PI - wrist_angles[1]),
            wrapToPi(wrist_angles[2] + PI)}}};
        const Eigen::Vector3d current_wrist{
          full_start_state->getVariablePosition("yaw_joint"),
          full_start_state->getVariablePosition("pitch_joint"),
          full_start_state->getVariablePosition("roll_joint")};
        std::optional<Eigen::Vector3d> selected_wrist;
        double best_wrist_distance = std::numeric_limits<double>::max();
        for (const auto & candidate : wrist_candidates) {
          auto candidate_state = locked_goal_state;
          candidate_state.setVariablePosition("yaw_joint", candidate[0]);
          candidate_state.setVariablePosition("pitch_joint", candidate[1]);
          candidate_state.setVariablePosition("roll_joint", candidate[2]);
          candidate_state.update();
          if (!candidate_state.satisfiesBounds()) continue;

          double distance = 0.0;
          for (int index = 0; index < 3; ++index) {
            distance += std::abs(wrapToPi(candidate[index] - current_wrist[index]));
          }
          if (distance < best_wrist_distance) {
            best_wrist_distance = distance;
            selected_wrist = candidate;
          }
        }
        if (!selected_wrist) {
          publishStatus(
            status_publisher,
            request.request_id,
            "FAILED",
            "The requested locked orientation exceeds the wrist joint limits.");
          continue;
        }
        locked_goal_state.setVariablePosition("yaw_joint", (*selected_wrist)[0]);
        locked_goal_state.setVariablePosition("pitch_joint", (*selected_wrist)[1]);
        locked_goal_state.setVariablePosition("roll_joint", (*selected_wrist)[2]);
        locked_goal_state.update();
        for (const auto & joint_name : {
          std::string{"base_joint"},
          std::string{"shoulder_joint"},
          std::string{"elbow_joint"},
          std::string{"yaw_joint"},
          std::string{"pitch_joint"},
          std::string{"roll_joint"}})
        {
          locked_goal.joint_constraints.push_back(
            jointConstraint(joint_name, locked_goal_state.getVariablePosition(joint_name)));
        }
        const Eigen::Quaterniond solved_orientation(
          locked_goal_state.getGlobalLinkTransform(END_EFFECTOR_LINK).rotation());
        const auto target_ee_translation =
          locked_goal_state.getGlobalLinkTransform(END_EFFECTOR_LINK).translation();
        geometry_msgs::msg::Point target_ee_position;
        target_ee_position.x = target_ee_translation.x();
        target_ee_position.y = target_ee_translation.y();
        target_ee_position.z = target_ee_translation.z();
        RCLCPP_INFO(
          node->get_logger(),
          "Locked goal pivot joints: base=%.4f shoulder=%.4f elbow=%.4f; EE position seed=(%.4f, %.4f, %.4f)",
          locked_goal_state.getVariablePosition("base_joint"),
          locked_goal_state.getVariablePosition("shoulder_joint"),
          locked_goal_state.getVariablePosition("elbow_joint"),
          target_ee_position.x,
          target_ee_position.y,
          target_ee_position.z);
        RCLCPP_INFO(
          node->get_logger(),
          "Locked wrist seed: yaw=%.4f pitch=%.4f roll=%.4f; solved EE quaternion=(%.4f, %.4f, %.4f, %.4f)",
          locked_goal_state.getVariablePosition("yaw_joint"),
          locked_goal_state.getVariablePosition("pitch_joint"),
          locked_goal_state.getVariablePosition("roll_joint"),
          solved_orientation.x(),
          solved_orientation.y(),
          solved_orientation.z(),
          solved_orientation.w());
        // The proximal joint constraints carry the J4-pivot solution. The
        // full group then solves the wrist joints for the requested EE
        // orientation. Keep orientation as a goal constraint rather than a
        // path constraint so the operator can adjust orientation while the
        // arm is already away from that new orientation.
        // The six joint constraints encode the MoveIt-generated state whose
        // FK satisfies both the pivot position and requested EE orientation.
        // Keeping the goal in joint space avoids asking OMPL to sample a
        // narrow geometric intersection around a wrist singularity.
        locked_goal.position_constraints.push_back(pivotPositionConstraint(request.pose.position));
        locked_goal.orientation_constraints.push_back(orientationConstraint(request.pose.orientation));
        motion_request.goal_constraints.push_back(locked_goal);
        planned_trajectory = planWithMoveIt(motion_request, request.generation, request.request_id);
      }

      if (!planned_trajectory) {
        if (is_superseded(request.generation)) continue;
        RCLCPP_WARN(
          node->get_logger(),
          "Planning request %llu failed: no complete joint-space plan",
          static_cast<unsigned long long>(request.request_id));
        publishStatus(
          status_publisher,
          request.request_id,
          "FAILED",
          "MoveIt2 could not find a joint-space plan.");
        continue;
      }

      auto trajectory = *planned_trajectory;

      if (is_superseded(request.generation)) continue;
      if (trajectory.joint_trajectory.joint_names.empty() ||
        trajectory.joint_trajectory.points.empty())
      {
        publishStatus(
          status_publisher,
          request.request_id,
          "FAILED",
          "MoveIt2 returned an empty joint-space plan.");
        continue;
      }

      const auto current_state = move_group.getCurrentState(2.0);
      if (!current_state) {
        publishStatus(
          status_publisher,
          request.request_id,
          "FAILED",
          "MoveIt2 could not read the current joint state.");
        continue;
      }

      robot_trajectory::RobotTrajectory timed_trajectory(
        move_group.getRobotModel(),
        planning_group);
      timed_trajectory.setRobotTrajectoryMsg(*current_state, trajectory);
      trajectory_processing::TimeOptimalTrajectoryGeneration time_parameterization;
      if (!time_parameterization.computeTimeStamps(
          timed_trajectory,
          VELOCITY_SCALING,
          ACCELERATION_SCALING))
      {
        publishStatus(
          status_publisher,
          request.request_id,
          "FAILED",
          "MoveIt2 could not time-parameterize the plan.");
        continue;
      }
      timed_trajectory.getRobotTrajectoryMsg(trajectory);

      RCLCPP_INFO(
        node->get_logger(),
        "Planning request %llu produced %zu points for %zu joints",
        static_cast<unsigned long long>(request.request_id),
        trajectory.joint_trajectory.points.size(),
        trajectory.joint_trajectory.joint_names.size());

      if (is_superseded(request.generation)) continue;

      if (!trajectory_client->wait_for_action_server(std::chrono::seconds(2))) {
        publishStatus(
          status_publisher,
          request.request_id,
          "FAILED",
          "The rover trajectory action is unavailable.");
        continue;
      }

      FollowJointTrajectory::Goal goal;
      goal.trajectory = trajectory.joint_trajectory;
      goal.trajectory.header.stamp = node->now();
      RCLCPP_INFO(
        node->get_logger(),
        "Planning request %llu sending %zu-joint trajectory to %s",
        static_cast<unsigned long long>(request.request_id),
        goal.trajectory.joint_names.size(),
        TRAJECTORY_ACTION);
      const auto goal_future = trajectory_client->async_send_goal(goal);

      while (rclcpp::ok() &&
        goal_future.wait_for(std::chrono::milliseconds(50)) != std::future_status::ready)
      {
        // Wait for the handle so a newer target can cancel it cleanly.
      }

      RCLCPP_INFO(
        node->get_logger(),
        "Planning request %llu received trajectory goal response",
        static_cast<unsigned long long>(request.request_id));

      if (!rclcpp::ok()) break;
      if (goal_future.wait_for(std::chrono::milliseconds(0)) != std::future_status::ready) {
        publishStatus(
          status_publisher,
          request.request_id,
          "FAILED",
          "The rover rejected the trajectory goal request.");
        continue;
      }

      const auto goal_handle = goal_future.get();
      if (!goal_handle) {
        publishStatus(
          status_publisher,
          request.request_id,
          "FAILED",
          "The rover rejected the trajectory goal.");
        continue;
      }

      {
        std::lock_guard<std::mutex> lock(action_mutex);
        active_goal = goal_handle;
      }

      publishStatus(status_publisher, request.request_id, "EXECUTING");
      const auto result_future = trajectory_client->async_get_result(goal_handle);
      bool cancel_requested = false;
      while (rclcpp::ok() &&
        result_future.wait_for(std::chrono::milliseconds(50)) != std::future_status::ready)
      {
        if (is_superseded(request.generation) && !cancel_requested) {
          trajectory_client->async_cancel_goal(goal_handle);
          cancel_requested = true;
        }
      }

      {
        std::lock_guard<std::mutex> lock(action_mutex);
        if (active_goal == goal_handle) active_goal.reset();
      }

      RCLCPP_INFO(
        node->get_logger(),
        "Planning request %llu received trajectory result",
        static_cast<unsigned long long>(request.request_id));

      if (!rclcpp::ok()) break;
      if (result_future.wait_for(std::chrono::milliseconds(0)) != std::future_status::ready) {
        publishStatus(
          status_publisher,
          request.request_id,
          "FAILED",
          "The rover trajectory result was interrupted.");
        continue;
      }

      const auto wrapped_result = result_future.get();
      const bool succeeded = wrapped_result.code == rclcpp_action::ResultCode::SUCCEEDED &&
        wrapped_result.result &&
        wrapped_result.result->error_code == FollowJointTrajectory::Result::SUCCESSFUL;

      if (succeeded && !is_superseded(request.generation)) {
        publishStatus(status_publisher, request.request_id, "SUCCEEDED");
      } else if (cancel_requested || is_superseded(request.generation) ||
        wrapped_result.code == rclcpp_action::ResultCode::CANCELED)
      {
        publishStatus(status_publisher, request.request_id, "CANCELED");
      } else {
        publishStatus(
          status_publisher,
          request.request_id,
          "FAILED",
          "The rover failed to execute the trajectory.");
      }
    }
  });

  executor.spin();

  {
    std::lock_guard<std::mutex> lock(target_mutex);
    shutting_down = true;
  }
  target_condition.notify_one();
  planning_thread.join();

  rclcpp::shutdown();
  return 0;
}
