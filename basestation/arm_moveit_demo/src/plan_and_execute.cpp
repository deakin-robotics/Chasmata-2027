#include <memory>
#include <thread>

#include <moveit/move_group_interface/move_group_interface.hpp>
#include <rclcpp/rclcpp.hpp>

int main(int argc, char * argv[])
{
  rclcpp::init(argc, argv);

  const auto node = rclcpp::Node::make_shared("arm_moveit_demo");

  node->declare_parameter<double>("target_dx", 0.0);
  node->declare_parameter<double>("target_dy", 0.0);
  node->declare_parameter<double>("target_dz", 0.03);
  node->declare_parameter<bool>("execute", true);

  rclcpp::executors::SingleThreadedExecutor executor;
  executor.add_node(node);
  std::thread spinner([&executor]() { executor.spin(); });

  moveit::planning_interface::MoveGroupInterface move_group(node, "arm");
  move_group.setPoseReferenceFrame("base_link");
  move_group.setEndEffectorLink("ee_link");
  move_group.setPlanningTime(5.0);
  move_group.setNumPlanningAttempts(10);
  move_group.setMaxVelocityScalingFactor(0.5);
  move_group.setMaxAccelerationScalingFactor(0.5);

  const auto current_pose = move_group.getCurrentPose("ee_link").pose;
  auto target_pose = current_pose;
  target_pose.position.x += node->get_parameter("target_dx").as_double();
  target_pose.position.y += node->get_parameter("target_dy").as_double();
  target_pose.position.z += node->get_parameter("target_dz").as_double();

  RCLCPP_INFO(
    node->get_logger(),
    "Planning from the current EE pose to (%.3f, %.3f, %.3f)",
    target_pose.position.x,
    target_pose.position.y,
    target_pose.position.z);

  move_group.setPoseTarget(target_pose, "ee_link");
  moveit::planning_interface::MoveGroupInterface::Plan plan;
  const auto planning_result = move_group.plan(plan);

  if (planning_result != moveit::core::MoveItErrorCode::SUCCESS) {
    RCLCPP_ERROR(node->get_logger(), "MoveIt 2 could not find a plan");
    move_group.clearPoseTargets();
    executor.cancel();
    spinner.join();
    rclcpp::shutdown();
    return 2;
  }

  RCLCPP_INFO(
    node->get_logger(),
    "Plan created with %zu trajectory points",
    plan.trajectory.joint_trajectory.points.size());

  if (node->get_parameter("execute").as_bool()) {
    const auto execution_result = move_group.execute(plan);
    if (execution_result != moveit::core::MoveItErrorCode::SUCCESS) {
      RCLCPP_ERROR(node->get_logger(), "MoveIt 2 trajectory execution failed");
      move_group.clearPoseTargets();
      executor.cancel();
      spinner.join();
      rclcpp::shutdown();
      return 3;
    }

    RCLCPP_INFO(node->get_logger(), "MoveIt 2 trajectory executed successfully");
  }

  move_group.clearPoseTargets();
  executor.cancel();
  spinner.join();
  rclcpp::shutdown();
  return 0;
}
