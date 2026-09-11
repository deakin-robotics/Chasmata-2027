#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <future>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include <control_msgs/action/follow_joint_trajectory.hpp>
#include <geometry_msgs/msg/pose_stamped.hpp>
#include <moveit/robot_trajectory/robot_trajectory.hpp>
#include <moveit/trajectory_processing/time_optimal_trajectory_generation.hpp>
#include <moveit/move_group_interface/move_group_interface.hpp>
#include <moveit_msgs/msg/constraints.hpp>
#include <moveit_msgs/msg/position_constraint.hpp>
#include <moveit_msgs/msg/robot_trajectory.hpp>
#include <moveit_msgs/msg/orientation_constraint.hpp>
#include <rclcpp/rclcpp.hpp>
#include <rclcpp_action/rclcpp_action.hpp>
#include <shape_msgs/msg/solid_primitive.hpp>
#include <std_msgs/msg/bool.hpp>
#include <std_msgs/msg/string.hpp>

namespace
{
constexpr char TARGET_TOPIC[] = "/arm/target_pose";
constexpr char ORIENTATION_LOCK_TOPIC[] = "/arm/orientation_lock";
constexpr char STATUS_TOPIC[] = "/arm/moveit/status";
constexpr char TRAJECTORY_ACTION[] = "/arm_controller/follow_joint_trajectory";
constexpr char PLANNING_GROUP[] = "arm";
constexpr char POSITION_PLANNING_GROUP[] = "position_arm";
constexpr char REFERENCE_FRAME[] = "base_link";
constexpr char END_EFFECTOR_LINK[] = "ee_link";
constexpr char J4_PIVOT_LINK[] = "j4_pivot_link";
constexpr double CARTESIAN_STEP_METRES = 0.01;
constexpr double CARTESIAN_FRACTION_REQUIRED = 0.999;
constexpr double PIVOT_POSITION_TOLERANCE_METRES = 0.005;
constexpr double VELOCITY_SCALING = 0.5;
constexpr double ACCELERATION_SCALING = 0.5;

using FollowJointTrajectory = control_msgs::action::FollowJointTrajectory;
using GoalHandle = rclcpp_action::ClientGoalHandle<FollowJointTrajectory>;

struct TargetRequest
{
  geometry_msgs::msg::Pose pose;
  std::uint64_t request_id;
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

bool orientationsMatch(
  const geometry_msgs::msg::Quaternion & first,
  const geometry_msgs::msg::Quaternion & second)
{
  const auto first_norm = std::sqrt(
    first.x * first.x + first.y * first.y + first.z * first.z + first.w * first.w);
  const auto second_norm = std::sqrt(
    second.x * second.x + second.y * second.y + second.z * second.z + second.w * second.w);
  if (first_norm <= 1e-12 || second_norm <= 1e-12) return false;

  const auto dot = std::abs(
    (first.x * second.x + first.y * second.y + first.z * second.z + first.w * second.w) /
    (first_norm * second_norm));
  return dot >= 1.0 - 1e-6;
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

  std::mutex target_mutex;
  std::condition_variable target_condition;
  std::optional<TargetRequest> pending_target;
  std::atomic<bool> orientation_locked{false};
  std::atomic<std::uint64_t> latest_request_id{0};
  std::atomic<std::uint64_t> fallback_sequence{0};
  bool shutting_down = false;

  std::mutex action_mutex;
  GoalHandle::SharedPtr active_goal;

  const auto target_subscription = node->create_subscription<geometry_msgs::msg::PoseStamped>(
    TARGET_TOPIC,
    rclcpp::QoS(10),
    [&](const geometry_msgs::msg::PoseStamped::SharedPtr message) {
      if (!message) return;

      const auto request_id = requestIdFromMessage(*message, fallback_sequence);
      {
        std::lock_guard<std::mutex> lock(target_mutex);
        pending_target = TargetRequest{message->pose, request_id, orientation_locked.load()};
        latest_request_id.store(request_id);
      }

      GoalHandle::SharedPtr goal;
      {
        std::lock_guard<std::mutex> lock(action_mutex);
        goal = active_goal;
      }
      if (goal) trajectory_client->async_cancel_goal(goal);

      target_condition.notify_one();
    });

  (void)target_subscription;

  const auto orientation_lock_subscription = node->create_subscription<std_msgs::msg::Bool>(
    ORIENTATION_LOCK_TOPIC,
    rclcpp::QoS(10),
    [&](const std_msgs::msg::Bool::SharedPtr message) {
      if (!message) return;

      orientation_locked.store(message->data);
      RCLCPP_INFO(
        node->get_logger(),
        "Orientation lock update received: %s",
        message->data ? "LOCKED" : "UNLOCKED");

      {
        std::lock_guard<std::mutex> lock(target_mutex);
        if (pending_target) pending_target->orientation_locked = message->data;
      }

      GoalHandle::SharedPtr goal;
      {
        std::lock_guard<std::mutex> lock(action_mutex);
        goal = active_goal;
      }
      if (goal) trajectory_client->async_cancel_goal(goal);
    });

  (void)orientation_lock_subscription;

  rclcpp::executors::SingleThreadedExecutor executor;
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
    }
    position_move_group.setEndEffectorLink(J4_PIVOT_LINK);
    full_move_group.setEndEffectorLink(END_EFFECTOR_LINK);

    RCLCPP_INFO(
      node->get_logger(),
      "MoveIt2 Cartesian bridge ready: %s -> %s -> %s",
      TARGET_TOPIC,
      STATUS_TOPIC,
      TRAJECTORY_ACTION);

    auto is_superseded = [&](std::uint64_t request_id) {
        return latest_request_id.load() > request_id;
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

      // The lock flag and target are separate ROS topics. Read the current
      // flag at the planning boundary so a target cannot use stale mode data
      // when the two callbacks arrive in either order.
      request.orientation_locked = orientation_locked.load();

      publishStatus(status_publisher, request.request_id, "PLANNING");

      if (is_superseded(request.request_id)) continue;

      auto & move_group = request.orientation_locked ? full_move_group : position_move_group;
      const auto planning_group = request.orientation_locked
        ? PLANNING_GROUP
        : POSITION_PLANNING_GROUP;
      move_group.setEndEffectorLink(
        request.orientation_locked ? END_EFFECTOR_LINK : J4_PIVOT_LINK);

      const auto current_pose_result = move_group.getCurrentPose(J4_PIVOT_LINK);
      auto current_pose = current_pose_result.pose;
      const auto current_end_effector_pose = move_group.getCurrentPose(END_EFFECTOR_LINK).pose;
      if (!std::isfinite(current_pose.position.x) ||
        !std::isfinite(current_pose.position.y) ||
        !std::isfinite(current_pose.position.z))
      {
        publishStatus(
          status_publisher,
          request.request_id,
          "FAILED",
          "MoveIt2 has no valid current J4 pivot pose.");
        continue;
      }

      RCLCPP_INFO(
        node->get_logger(),
        "Cartesian request %llu (%s): current J4 pivot=(%.3f, %.3f, %.3f), target=(%.3f, %.3f, %.3f)",
        static_cast<unsigned long long>(request.request_id),
        request.orientation_locked ? "locked" : "unlocked",
        current_pose.position.x,
        current_pose.position.y,
        current_pose.position.z,
        request.pose.position.x,
        request.pose.position.y,
        request.pose.position.z);

      geometry_msgs::msg::Pose target_pose = request.pose;
      moveit_msgs::msg::Constraints path_constraints;

      if (request.orientation_locked) {
        moveit_msgs::msg::OrientationConstraint orientation_constraint;
        orientation_constraint.header.frame_id = REFERENCE_FRAME;
        orientation_constraint.link_name = END_EFFECTOR_LINK;
        orientation_constraint.orientation = request.pose.orientation;
        orientation_constraint.absolute_x_axis_tolerance = 0.02;
        orientation_constraint.absolute_y_axis_tolerance = 0.02;
        orientation_constraint.absolute_z_axis_tolerance = 0.02;
        orientation_constraint.weight = 1.0;
        path_constraints.orientation_constraints.push_back(orientation_constraint);
      } else {
        move_group.clearPathConstraints();
      }

      const auto dx = target_pose.position.x - current_pose.position.x;
      const auto dy = target_pose.position.y - current_pose.position.y;
      const auto dz = target_pose.position.z - current_pose.position.z;
      const auto distance = std::sqrt(dx * dx + dy * dy + dz * dz);
      const auto orientation_matches = orientationsMatch(
        current_end_effector_pose.orientation,
        request.pose.orientation);
      if (distance < 1e-6 && (!request.orientation_locked || orientation_matches)) {
        RCLCPP_INFO(
          node->get_logger(),
          "Cartesian request %llu already at target; no trajectory required",
          static_cast<unsigned long long>(request.request_id));
        publishStatus(status_publisher, request.request_id, "SUCCEEDED");
        continue;
      }

      const auto waypoint_count = std::max<std::size_t>(
        1,
        static_cast<std::size_t>(std::ceil(distance / CARTESIAN_STEP_METRES)));

      if (request.orientation_locked) {
        // The full group uses ee_link as its Cartesian tip, so add a small
        // sphere for every requested pivot waypoint. This keeps the wrist
        // orientation constraint while requiring the off-chain J4 pivot to
        // stay on the same straight line as the target.
        moveit_msgs::msg::PositionConstraint pivot_constraint;
        pivot_constraint.header.frame_id = REFERENCE_FRAME;
        pivot_constraint.link_name = J4_PIVOT_LINK;
        pivot_constraint.weight = 1.0;

        shape_msgs::msg::SolidPrimitive pivot_region;
        pivot_region.type = shape_msgs::msg::SolidPrimitive::SPHERE;
        pivot_region.dimensions = {PIVOT_POSITION_TOLERANCE_METRES};

        for (std::size_t index = 1; index <= waypoint_count; ++index) {
          const auto fraction = static_cast<double>(index) / waypoint_count;
          geometry_msgs::msg::Pose pivot_waypoint;
          pivot_waypoint.position.x = current_pose.position.x + dx * fraction;
          pivot_waypoint.position.y = current_pose.position.y + dy * fraction;
          pivot_waypoint.position.z = current_pose.position.z + dz * fraction;
          pivot_waypoint.orientation.w = 1.0;
          pivot_constraint.constraint_region.primitives.push_back(pivot_region);
          pivot_constraint.constraint_region.primitive_poses.push_back(pivot_waypoint);
        }

        path_constraints.position_constraints.push_back(pivot_constraint);
      }

      std::vector<geometry_msgs::msg::Pose> waypoints;
      waypoints.reserve(waypoint_count);
      for (std::size_t index = 1; index <= waypoint_count; ++index) {
        const auto fraction = static_cast<double>(index) / waypoint_count;
        auto waypoint = request.orientation_locked ? current_end_effector_pose : current_pose;
        if (request.orientation_locked) {
          waypoint.position.x += dx * fraction;
          waypoint.position.y += dy * fraction;
          waypoint.position.z += dz * fraction;
          waypoint.orientation = request.pose.orientation;
        } else {
          waypoint.position.x += dx * fraction;
          waypoint.position.y += dy * fraction;
          waypoint.position.z += dz * fraction;
          waypoint.orientation = current_pose.orientation;
        }
        waypoints.push_back(waypoint);
      }

      move_group.setStartStateToCurrentState();
      moveit_msgs::msg::RobotTrajectory trajectory;
      const auto fraction = request.orientation_locked
        ? move_group.computeCartesianPath(
          waypoints,
          CARTESIAN_STEP_METRES,
          trajectory,
          path_constraints,
          false)
        : move_group.computeCartesianPath(
          waypoints,
          CARTESIAN_STEP_METRES,
          trajectory,
          false);

      RCLCPP_INFO(
        node->get_logger(),
        "Cartesian request %llu: %.1f%% of path, %zu trajectory points",
        static_cast<unsigned long long>(request.request_id),
        fraction * 100.0,
        trajectory.joint_trajectory.points.size());

      if (is_superseded(request.request_id)) continue;

      if (fraction < CARTESIAN_FRACTION_REQUIRED ||
        trajectory.joint_trajectory.joint_names.empty() ||
        trajectory.joint_trajectory.points.empty())
      {
        RCLCPP_WARN(
          node->get_logger(),
          "Cartesian request %llu rejected because the path was incomplete",
          static_cast<unsigned long long>(request.request_id));
        publishStatus(
          status_publisher,
          request.request_id,
          "FAILED",
          "MoveIt2 could not complete the Cartesian path.");
        continue;
      }

      RCLCPP_INFO(
        node->get_logger(),
        "Cartesian request %llu reading current joint state",
        static_cast<unsigned long long>(request.request_id));
      const auto current_state = move_group.getCurrentState(2.0);
      if (!current_state) {
        publishStatus(
          status_publisher,
          request.request_id,
          "FAILED",
          "MoveIt2 could not read the current joint state.");
        continue;
      }
      RCLCPP_INFO(
        node->get_logger(),
        "Cartesian request %llu received current joint state",
        static_cast<unsigned long long>(request.request_id));

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
          "MoveIt2 could not time-parameterize the Cartesian path.");
        continue;
      }
      timed_trajectory.getRobotTrajectoryMsg(trajectory);

      RCLCPP_INFO(
        node->get_logger(),
        "Cartesian request %llu time-parameterized with %zu points",
        static_cast<unsigned long long>(request.request_id),
        trajectory.joint_trajectory.points.size());

      if (is_superseded(request.request_id)) continue;

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
        "Cartesian request %llu sending %zu-joint trajectory to %s",
        static_cast<unsigned long long>(request.request_id),
        goal.trajectory.joint_names.size(),
        TRAJECTORY_ACTION);
      const auto goal_future = trajectory_client->async_send_goal(goal);

      while (rclcpp::ok() &&
        goal_future.wait_for(std::chrono::milliseconds(50)) != std::future_status::ready)
      {
        // Wait for the goal handle even if a newer target arrives. Once the
        // handle exists, the result loop can cancel it cleanly.
      }

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
        if (is_superseded(request.request_id) && !cancel_requested) {
          trajectory_client->async_cancel_goal(goal_handle);
          cancel_requested = true;
        }
      }

      {
        std::lock_guard<std::mutex> lock(action_mutex);
        if (active_goal == goal_handle) active_goal.reset();
      }

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

      if (succeeded && !is_superseded(request.request_id)) {
        publishStatus(status_publisher, request.request_id, "SUCCEEDED");
      } else if (cancel_requested || is_superseded(request.request_id) ||
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
