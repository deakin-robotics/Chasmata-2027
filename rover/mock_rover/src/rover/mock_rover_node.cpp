#include "mock_rover_node_impl.hpp"
#include "../drive/mock_drive_backend.hpp"

namespace mock_rover
{
MockRoverNode::MockRoverNode(std::unique_ptr<DriveBackend> drive_backend)
: Node("mock_rover"), joints_(std::vector<std::string>(kJointNames.begin(), kJointNames.end()), kJointLimits, 1.0),
  drive_backend_(std::move(drive_backend))
{
  declare_parameter<double>("publish_rate_hz", 10.0);
  declare_parameter<double>("mode_ack_delay_ms", 150.0);
  const auto rate = std::max(get_parameter("publish_rate_hz").as_double(), 1.0);
  ack_delay_ = std::max(get_parameter("mode_ack_delay_ms").as_double() / 1000.0, 0.0);
  if (!drive_backend_) drive_backend_ = std::make_unique<MockDriveBackend>(ack_delay_);

  const auto retained = rclcpp::QoS(rclcpp::KeepLast(1)).reliable().transient_local();
  fma_publisher_ = create_publisher<telemetry_interfaces::msg::FmaState>("/fma/state", retained);
  joint_state_publisher_ = create_publisher<sensor_msgs::msg::JointState>("/arm/joint_states", 10);
  heartbeat_publisher_ = create_publisher<std_msgs::msg::Empty>("/rover/heartbeat",
    rclcpp::QoS(rclcpp::KeepLast(1)).reliable());

  subscriptions_.push_back(create_subscription<sensor_msgs::msg::JointState>("/arm/joint_commands", 10,
    std::bind(&MockRoverNode::on_joint_command, this, std::placeholders::_1)));
  subscriptions_.push_back(create_subscription<sensor_msgs::msg::Joy>("/drive/joy", 10,
    [this](sensor_msgs::msg::Joy::SharedPtr message) { on_joy("drive", *message, 4, 5); }));
  subscriptions_.push_back(create_subscription<sensor_msgs::msg::Joy>("/arm/joy", 10,
    [this](sensor_msgs::msg::Joy::SharedPtr message) { on_joy("arm", *message, 8, 9); }));
  subscriptions_.push_back(create_subscription<std_msgs::msg::Bool>("/arm/orientation_lock", 10,
    [this](std_msgs::msg::Bool::SharedPtr message) { orientation_locked_ = message->data; }));
  subscriptions_.push_back(create_subscription<std_msgs::msg::String>("/fma/drive/request", 10,
    [this](std_msgs::msg::String::SharedPtr message) { request_mode("drive", message->data); }));
  subscriptions_.push_back(create_subscription<std_msgs::msg::String>("/fma/arm/request", 10,
    [this](std_msgs::msg::String::SharedPtr message) { request_mode("arm", message->data); }));
  subscriptions_.push_back(create_subscription<std_msgs::msg::String>("/arm/override/request", 10,
    [this](std_msgs::msg::String::SharedPtr message) { request_override(message->data); }));
  subscriptions_.push_back(create_subscription<std_msgs::msg::String>("/fma/gimbal/request", 10,
    [this](std_msgs::msg::String::SharedPtr message) { request_gimbal(message->data); }));

  trajectory_server_ = rclcpp_action::create_server<FollowJointTrajectory>(this,
    "/arm_controller/follow_joint_trajectory",
    std::bind(&MockRoverNode::handle_goal, this, std::placeholders::_1, std::placeholders::_2),
    std::bind(&MockRoverNode::handle_cancel, this, std::placeholders::_1),
    std::bind(&MockRoverNode::handle_accepted, this, std::placeholders::_1));
  tick_timer_ = create_wall_timer(std::chrono::duration<double>(1.0 / rate),
    std::bind(&MockRoverNode::tick, this));
  heartbeat_timer_ = create_wall_timer(std::chrono::seconds(1), [this]() { publish_heartbeat(); });
  publish_fma();
  publish_joint_state();
  publish_heartbeat();
}

void MockRoverNode::publish_joint_state()
{
  std::lock_guard<std::recursive_mutex> lock(joints_mutex_);
  sensor_msgs::msg::JointState message; message.header.stamp = get_clock()->now();
  const auto positions = joints_.positions(); const auto velocities = joints_.velocities();
  for (const auto * name : kJointNames) { message.name.emplace_back(name); message.position.push_back(positions.at(name)); message.velocity.push_back(velocities.at(name)); }
  joint_state_publisher_->publish(message);
}
void MockRoverNode::publish_heartbeat() { heartbeat_publisher_->publish(std_msgs::msg::Empty{}); }
}  // namespace mock_rover

std::shared_ptr<rclcpp::Node> mock_rover::make_mock_rover_node()
{
  return std::make_shared<MockRoverNode>(nullptr);
}

std::shared_ptr<rclcpp::Node> mock_rover::make_mock_rover_node(std::unique_ptr<DriveBackend> drive_backend)
{
  return std::make_shared<MockRoverNode>(std::move(drive_backend));
}
