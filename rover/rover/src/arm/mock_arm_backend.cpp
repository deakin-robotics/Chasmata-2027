#include "mock_arm_backend.hpp"

namespace rover
{
MockArmBackend::MockArmBackend(rclcpp::Node & node, double delay_seconds)
: joints_(std::vector<std::string>(kJointNames.begin(), kJointNames.end()), kJointLimits, 1.0),
  node_(node), delay_(std::chrono::duration_cast<std::chrono::steady_clock::duration>(std::chrono::duration<double>(delay_seconds)))
{
  joint_state_publisher_ = node_.create_publisher<sensor_msgs::msg::JointState>("/arm/joint_states", 10);
  subscriptions_.push_back(node_.create_subscription<sensor_msgs::msg::JointState>("/arm/joint_commands", 10,
    std::bind(&MockArmBackend::on_joint_command, this, std::placeholders::_1)));
  subscriptions_.push_back(node_.create_subscription<sensor_msgs::msg::Joy>("/arm/joy", 10,
    [this](sensor_msgs::msg::Joy::SharedPtr message) { on_joy(*message); }));
  subscriptions_.push_back(node_.create_subscription<std_msgs::msg::Bool>("/arm/orientation_lock", 10,
    [this](std_msgs::msg::Bool::SharedPtr message) { orientation_locked_ = message->data; }));
  trajectory_server_ = rclcpp_action::create_server<FollowJointTrajectory>(&node_, "/arm_controller/follow_joint_trajectory",
    std::bind(&MockArmBackend::handle_goal, this, std::placeholders::_1, std::placeholders::_2),
    std::bind(&MockArmBackend::handle_cancel, this, std::placeholders::_1),
    std::bind(&MockArmBackend::handle_accepted, this, std::placeholders::_1));
  publish_joint_state();
}
void MockArmBackend::request_mode(const std::string & mode)
{
  requested_mode_ = mode;
  due_ = std::chrono::steady_clock::now() + delay_;
}
void MockArmBackend::cancel_mode_request() { due_.reset(); }
std::optional<bool> MockArmBackend::take_mode_result()
{
  if (!due_ || std::chrono::steady_clock::now() < *due_) return std::nullopt;
  due_.reset();
  arm_mode_ = requested_mode_;
  return true;
}
void MockArmBackend::publish_joint_state()
{
  std::lock_guard<std::recursive_mutex> lock(joints_mutex_);
  sensor_msgs::msg::JointState message; message.header.stamp = node_.get_clock()->now();
  const auto positions = joints_.positions(); const auto velocities = joints_.velocities();
  for (const auto * name : kJointNames) { message.name.emplace_back(name); message.position.push_back(positions.at(name)); message.velocity.push_back(velocities.at(name)); }
  joint_state_publisher_->publish(message);
}
}  // namespace rover
