#include <chrono>
#include <functional>
#include <memory>

#include <control_msgs/action/follow_joint_trajectory.hpp>
#include <rclcpp/rclcpp.hpp>
#include <rclcpp_action/rclcpp_action.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <sensor_msgs/msg/joy.hpp>
#include <std_msgs/msg/bool.hpp>
#include <std_msgs/msg/string.hpp>

using namespace std::chrono_literals;

class RoverControlNode final : public rclcpp::Node
{
public:
  using FollowJointTrajectory = control_msgs::action::FollowJointTrajectory;
  using GoalHandleFollowJointTrajectory =
    rclcpp_action::ServerGoalHandle<FollowJointTrajectory>;

  RoverControlNode()
  : Node("rover_control")
  {
    joint_state_publisher_ = create_publisher<sensor_msgs::msg::JointState>(
      "/joint_states", rclcpp::QoS(10));
    fma_state_publisher_ = create_publisher<std_msgs::msg::String>(
      "/fma/state", rclcpp::QoS(1).transient_local().reliable());

    joint_command_subscription_ = create_subscription<sensor_msgs::msg::JointState>(
      "/joint_commands", 10,
      std::bind(&RoverControlNode::joint_command_callback, this, std::placeholders::_1));
    drive_joy_subscription_ = create_subscription<sensor_msgs::msg::Joy>(
      "/joy", 10,
      std::bind(&RoverControlNode::drive_joy_callback, this, std::placeholders::_1));
    arm_joy_subscription_ = create_subscription<sensor_msgs::msg::Joy>(
      "/arm/joy", 10,
      std::bind(&RoverControlNode::arm_joy_callback, this, std::placeholders::_1));
    orientation_lock_subscription_ = create_subscription<std_msgs::msg::Bool>(
      "/arm/orientation_lock", 10,
      std::bind(&RoverControlNode::orientation_lock_callback, this, std::placeholders::_1));
    drive_mode_subscription_ = create_subscription<std_msgs::msg::String>(
      "/fma/drive/request", 10,
      std::bind(&RoverControlNode::drive_mode_callback, this, std::placeholders::_1));
    arm_mode_subscription_ = create_subscription<std_msgs::msg::String>(
      "/fma/arm/request", 10,
      std::bind(&RoverControlNode::arm_mode_callback, this, std::placeholders::_1));
    arm_override_subscription_ = create_subscription<std_msgs::msg::String>(
      "/arm/override/request", 10,
      std::bind(&RoverControlNode::arm_override_callback, this, std::placeholders::_1));
    gimbal_priority_subscription_ = create_subscription<std_msgs::msg::String>(
      "/fma/gimbal/request", 10,
      std::bind(&RoverControlNode::gimbal_priority_callback, this, std::placeholders::_1));

    trajectory_action_server_ = rclcpp_action::create_server<FollowJointTrajectory>(
      this,
      "/arm_controller/follow_joint_trajectory",
      std::bind(&RoverControlNode::trajectory_goal_callback, this,
        std::placeholders::_1, std::placeholders::_2),
      std::bind(&RoverControlNode::trajectory_cancel_callback, this,
        std::placeholders::_1),
      std::bind(&RoverControlNode::trajectory_accepted_callback, this,
        std::placeholders::_1));

    RCLCPP_INFO(
      get_logger(),
      "Rover control contract scaffold ready; no hardware behavior is implemented");
  }

private:
  void todo(const char * interface_name)
  {
    RCLCPP_WARN_THROTTLE(
      get_logger(), *get_clock(), 5000,
      "TODO(Control): %s is not implemented; no command or telemetry was produced",
      interface_name);
  }

  void joint_command_callback(const sensor_msgs::msg::JointState::SharedPtr)
  {
    todo("/joint_commands");
  }

  void drive_joy_callback(const sensor_msgs::msg::Joy::SharedPtr)
  {
    todo("/joy");
  }

  void arm_joy_callback(const sensor_msgs::msg::Joy::SharedPtr)
  {
    todo("/arm/joy");
  }

  void orientation_lock_callback(const std_msgs::msg::Bool::SharedPtr)
  {
    todo("/arm/orientation_lock");
  }

  void drive_mode_callback(const std_msgs::msg::String::SharedPtr)
  {
    todo("/fma/drive/request");
  }

  void arm_mode_callback(const std_msgs::msg::String::SharedPtr)
  {
    todo("/fma/arm/request");
  }

  void arm_override_callback(const std_msgs::msg::String::SharedPtr)
  {
    todo("/arm/override/request");
  }

  void gimbal_priority_callback(const std_msgs::msg::String::SharedPtr)
  {
    todo("/fma/gimbal/request");
  }

  rclcpp_action::GoalResponse trajectory_goal_callback(
    const rclcpp_action::GoalUUID &, std::shared_ptr<const FollowJointTrajectory::Goal>)
  {
    RCLCPP_WARN(
      get_logger(),
      "TODO(Control): rejecting /arm_controller/follow_joint_trajectory; "
      "the six-joint hardware implementation is not connected");
    return rclcpp_action::GoalResponse::REJECT;
  }

  rclcpp_action::CancelResponse trajectory_cancel_callback(
    const std::shared_ptr<GoalHandleFollowJointTrajectory>)
  {
    return rclcpp_action::CancelResponse::ACCEPT;
  }

  void trajectory_accepted_callback(const std::shared_ptr<GoalHandleFollowJointTrajectory>)
  {
    // A goal is rejected in trajectory_goal_callback. This remains as an
    // explicit guard if that policy changes while the hardware is integrated.
    todo("/arm_controller/follow_joint_trajectory execution");
  }

  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr joint_state_publisher_;
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr fma_state_publisher_;

  rclcpp::Subscription<sensor_msgs::msg::JointState>::SharedPtr
    joint_command_subscription_;
  rclcpp::Subscription<sensor_msgs::msg::Joy>::SharedPtr drive_joy_subscription_;
  rclcpp::Subscription<sensor_msgs::msg::Joy>::SharedPtr arm_joy_subscription_;
  rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr
    orientation_lock_subscription_;
  rclcpp::Subscription<std_msgs::msg::String>::SharedPtr drive_mode_subscription_;
  rclcpp::Subscription<std_msgs::msg::String>::SharedPtr arm_mode_subscription_;
  rclcpp::Subscription<std_msgs::msg::String>::SharedPtr arm_override_subscription_;
  rclcpp::Subscription<std_msgs::msg::String>::SharedPtr
    gimbal_priority_subscription_;

  rclcpp_action::Server<FollowJointTrajectory>::SharedPtr trajectory_action_server_;
};

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<RoverControlNode>());
  rclcpp::shutdown();
  return 0;
}
