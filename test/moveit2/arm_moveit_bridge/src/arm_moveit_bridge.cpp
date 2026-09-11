#include <condition_variable>
#include <memory>
#include <mutex>
#include <optional>
#include <thread>

#include <geometry_msgs/msg/pose_stamped.hpp>
#include <moveit/move_group_interface/move_group_interface.hpp>
#include <rclcpp/rclcpp.hpp>
#include <sensor_msgs/msg/joint_state.hpp>

namespace
{
constexpr char TARGET_TOPIC[] = "/arm/target_pose";
constexpr char SOLUTION_TOPIC[] = "/arm/moveit/solution";
constexpr char PLANNING_GROUP[] = "arm";
constexpr char REFERENCE_FRAME[] = "base_link";
constexpr char END_EFFECTOR_LINK[] = "ee_link";
}

int main(int argc, char * argv[])
{
  rclcpp::init(argc, argv);

  const auto node = rclcpp::Node::make_shared("arm_moveit_bridge");
  const auto solution_publisher = node->create_publisher<sensor_msgs::msg::JointState>(
    SOLUTION_TOPIC,
    rclcpp::QoS(10));

  std::mutex target_mutex;
  std::condition_variable target_condition;
  std::optional<geometry_msgs::msg::Pose> pending_target;
  bool shutting_down = false;

  const auto target_subscription = node->create_subscription<geometry_msgs::msg::PoseStamped>(
    TARGET_TOPIC,
    rclcpp::QoS(10),
    [&](const geometry_msgs::msg::PoseStamped::SharedPtr message) {
      if (!message) return;

      {
        std::lock_guard<std::mutex> lock(target_mutex);
        pending_target = message->pose;
      }
      target_condition.notify_one();
    });

  (void)target_subscription;

  rclcpp::executors::SingleThreadedExecutor executor;
  executor.add_node(node);

  std::thread planning_thread([&]() {
    moveit::planning_interface::MoveGroupInterface move_group(node, PLANNING_GROUP);
    move_group.setPoseReferenceFrame(REFERENCE_FRAME);
    move_group.setEndEffectorLink(END_EFFECTOR_LINK);
    move_group.setPlanningTime(5.0);
    move_group.setNumPlanningAttempts(10);
    move_group.setMaxVelocityScalingFactor(0.5);
    move_group.setMaxAccelerationScalingFactor(0.5);

    RCLCPP_INFO(
      node->get_logger(),
      "MoveIt2 source bridge ready: %s -> %s",
      TARGET_TOPIC,
      SOLUTION_TOPIC);

    while (rclcpp::ok()) {
      geometry_msgs::msg::Pose target;
      {
        std::unique_lock<std::mutex> lock(target_mutex);
        target_condition.wait(lock, [&]() { return shutting_down || pending_target.has_value(); });

        if (shutting_down) return;

        target = *pending_target;
        pending_target.reset();
      }

      move_group.clearPoseTargets();
      move_group.setPoseTarget(target, END_EFFECTOR_LINK);

      moveit::planning_interface::MoveGroupInterface::Plan plan;
      const auto planning_result = move_group.plan(plan);
      if (planning_result != moveit::core::MoveItErrorCode::SUCCESS) {
        RCLCPP_WARN(node->get_logger(), "MoveIt2 could not solve the requested target pose");
        move_group.clearPoseTargets();
        continue;
      }

      const auto & joint_trajectory = plan.trajectory.joint_trajectory;
      if (joint_trajectory.joint_names.empty() || joint_trajectory.points.empty()) {
        RCLCPP_WARN(node->get_logger(), "MoveIt2 returned an empty joint solution");
        move_group.clearPoseTargets();
        continue;
      }

      const auto & final_point = joint_trajectory.points.back();
      if (joint_trajectory.joint_names.size() != final_point.positions.size()) {
        RCLCPP_WARN(node->get_logger(), "MoveIt2 returned mismatched joint names and positions");
        move_group.clearPoseTargets();
        continue;
      }

      sensor_msgs::msg::JointState solution;
      solution.name = joint_trajectory.joint_names;
      solution.position = final_point.positions;
      solution_publisher->publish(solution);

      RCLCPP_INFO(
        node->get_logger(),
        "Published MoveIt2 joint solution with %zu joints",
        solution.name.size());
      move_group.clearPoseTargets();
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
