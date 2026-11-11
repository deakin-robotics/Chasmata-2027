#include "rover_node_impl.hpp"
#include "../drive/mock_drive_backend.hpp"
#include "../drive/real_drive_backend.hpp"
#include "../arm/mock_arm_backend.hpp"
#include "../arm/real_arm_backend.hpp"

namespace rover
{
RoverNode::RoverNode(std::unique_ptr<DriveBackend> drive_backend, const rclcpp::NodeOptions & options)
: Node("rover", options), drive_backend_(std::move(drive_backend))
{
  declare_parameter<double>("publish_rate_hz", 10.0);
  declare_parameter<double>("mode_ack_delay_ms", 150.0);
  declare_parameter<std::string>("drive_backend", "mock");
  declare_parameter<std::string>("arm_backend", "mock");
  declare_parameter<double>("drive_max_wheel_speed", 0.0);
  declare_parameter<double>("drive_wheel_radius", 0.0);
  declare_parameter<double>("drive_wheel_separation", 0.0);
  const auto rate = std::max(get_parameter("publish_rate_hz").as_double(), 1.0);
  ack_delay_ = std::max(get_parameter("mode_ack_delay_ms").as_double() / 1000.0, 0.0);
  if (!drive_backend_) {
    const auto backend = get_parameter("drive_backend").as_string();
    if (backend == "mock") drive_backend_ = std::make_unique<MockDriveBackend>(ack_delay_);
    else if (backend == "real") drive_backend_ = std::make_unique<RealDriveBackend>(*this, get_parameter("drive_max_wheel_speed").as_double(),
      get_parameter("drive_wheel_radius").as_double(), get_parameter("drive_wheel_separation").as_double());
    else throw std::invalid_argument("drive_backend must be mock or real");
  }

  const auto arm_backend = get_parameter("arm_backend").as_string();
  if (arm_backend == "mock") arm_backend_ = std::make_unique<MockArmBackend>(*this, ack_delay_);
  else if (arm_backend == "real") arm_backend_ = std::make_unique<RealArmBackend>(*this);
  else throw std::invalid_argument("arm_backend must be mock or real");

  const auto retained = rclcpp::QoS(rclcpp::KeepLast(1)).reliable().transient_local();
  fma_publisher_ = create_publisher<telemetry_interfaces::msg::FmaState>("/fma/state", retained);
  heartbeat_publisher_ = create_publisher<std_msgs::msg::Empty>("/rover/heartbeat",
    rclcpp::QoS(rclcpp::KeepLast(1)).reliable());

  subscriptions_.push_back(create_subscription<sensor_msgs::msg::Joy>("/drive/joy", 10,
    [this](sensor_msgs::msg::Joy::SharedPtr message) { on_drive_joy(*message); }));
  subscriptions_.push_back(create_subscription<std_msgs::msg::String>("/fma/drive/request", 10,
    [this](std_msgs::msg::String::SharedPtr message) { request_mode("drive", message->data); }));
  subscriptions_.push_back(create_subscription<std_msgs::msg::String>("/fma/arm/request", 10,
    [this](std_msgs::msg::String::SharedPtr message) { request_mode("arm", message->data); }));
  subscriptions_.push_back(create_subscription<std_msgs::msg::String>("/arm/override/request", 10,
    [this](std_msgs::msg::String::SharedPtr message) { request_override(message->data); }));
  subscriptions_.push_back(create_subscription<std_msgs::msg::String>("/fma/gimbal/request", 10,
    [this](std_msgs::msg::String::SharedPtr message) { request_gimbal(message->data); }));

  tick_timer_ = create_wall_timer(std::chrono::duration<double>(1.0 / rate),
    std::bind(&RoverNode::tick, this));
  heartbeat_timer_ = create_wall_timer(std::chrono::seconds(1), [this]() { publish_heartbeat(); });
  publish_fma();
  publish_heartbeat();
}

RoverNode::~RoverNode() = default;

void RoverNode::publish_heartbeat() { heartbeat_publisher_->publish(std_msgs::msg::Empty{}); }
}  // namespace rover

std::shared_ptr<rclcpp::Node> rover::make_rover_node()
{
  return std::make_shared<RoverNode>(nullptr);
}

std::shared_ptr<rclcpp::Node> rover::make_rover_node(const rclcpp::NodeOptions & options)
{
  return std::make_shared<RoverNode>(nullptr, options);
}

std::shared_ptr<rclcpp::Node> rover::make_rover_node(std::unique_ptr<DriveBackend> drive_backend)
{
  return std::make_shared<RoverNode>(std::move(drive_backend));
}

void rover::RoverNode::on_drive_joy(const sensor_msgs::msg::Joy & message)
{
  if (message.axes.size() <= 5) return;
  for (const auto axis : {message.axes[4], message.axes[5]}) {
    if (!std::isfinite(axis) || axis < 0.0 || axis > 1.0) return;
  }
  if (std::any_of(message.buttons.begin(), message.buttons.end(), [](int32_t value) { return value != 0 && value != 1; })) return;
  drive_backend_->on_joy(message);
}
