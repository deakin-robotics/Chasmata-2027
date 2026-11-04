#include <algorithm>
#include <chrono>
#include <cctype>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/empty.hpp>
#include <std_msgs/msg/string.hpp>
#include <telemetry_interfaces/msg/arm_override_state.hpp>
#include <telemetry_interfaces/msg/fma_mode_state.hpp>
#include <telemetry_interfaces/msg/fma_state.hpp>

#include "prod_rover/rover_control_node.hpp"

namespace prod_rover
{
namespace
{
std::string upper_trimmed(std::string value)
{
  const auto first = value.find_first_not_of(" \t\n\r");
  const auto last = value.find_last_not_of(" \t\n\r");
  value = first == std::string::npos ? "" : value.substr(first, last - first + 1);
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char character) {
    return static_cast<char>(std::toupper(character));
  });
  return value;
}
}  // namespace

class RoverControlNode : public rclcpp::Node
{
public:
  RoverControlNode()
  : Node("rover_control")
  {
    declare_parameter<std::string>("mode", "dev");
    declare_parameter<double>("mode_ack_delay_ms", 150.0);
    const auto mode = get_parameter("mode").as_string();
    if (mode != "dev" && mode != "prod") {
      throw std::invalid_argument("mode must be 'dev' or 'prod'");
    }
    ack_delay_ = std::max(get_parameter("mode_ack_delay_ms").as_double() / 1000.0, 0.0);

    const auto retained = rclcpp::QoS(rclcpp::KeepLast(1)).reliable().transient_local();
    fma_publisher_ = create_publisher<telemetry_interfaces::msg::FmaState>("/fma/state", retained);
    heartbeat_publisher_ = create_publisher<std_msgs::msg::Empty>(
      "/rover/heartbeat", rclcpp::QoS(rclcpp::KeepLast(1)).reliable());
    subscriptions_.push_back(create_subscription<std_msgs::msg::String>("/fma/drive/request", 10,
      [this](std_msgs::msg::String::SharedPtr message) { request_mode("drive", message->data); }));
    subscriptions_.push_back(create_subscription<std_msgs::msg::String>("/fma/arm/request", 10,
      [this](std_msgs::msg::String::SharedPtr message) { request_mode("arm", message->data); }));
    subscriptions_.push_back(create_subscription<std_msgs::msg::String>("/arm/override/request", 10,
      [this](std_msgs::msg::String::SharedPtr message) { request_override(message->data); }));
    subscriptions_.push_back(create_subscription<std_msgs::msg::String>("/fma/gimbal/request", 10,
      [this](std_msgs::msg::String::SharedPtr message) { request_gimbal(message->data); }));
    tick_timer_ = create_wall_timer(std::chrono::milliseconds(20), std::bind(&RoverControlNode::tick, this));
    heartbeat_timer_ = create_wall_timer(std::chrono::seconds(1), [this]() { publish_heartbeat(); });
    publish_fma();
    publish_heartbeat();
  }

private:
  struct Pending { std::string value; std::chrono::steady_clock::time_point due; };

  void request_mode(const std::string & subsystem, const std::string & raw_mode)
  {
    const auto mode = upper_trimmed(raw_mode);
    const auto & valid = subsystem == "drive" ? drive_modes_ : arm_modes_;
    if (valid.count(mode) == 0) {
      rejected_modes_[subsystem] = mode;
      pending_modes_.erase(subsystem);
      rejection_clear_[subsystem] = std::chrono::steady_clock::now() + std::chrono::milliseconds(500);
    } else {
      rejected_modes_.erase(subsystem);
      rejection_clear_.erase(subsystem);
      pending_modes_[subsystem] = Pending{mode, due_time()};
    }
    publish_fma();
  }

  void request_override(const std::string & raw)
  {
    const auto command = upper_trimmed(raw);
    if (command == "ENABLE" || command == "DISABLE") {
      pending_override_ = Pending{command, due_time()};
      publish_fma();
    }
  }

  void request_gimbal(const std::string & raw)
  {
    const auto owner = upper_trimmed(raw);
    if (owner == "DRIVER" || owner == "ARM OPS") {
      pending_gimbal_ = Pending{owner, due_time()};
      publish_fma();
    }
  }

  std::chrono::steady_clock::time_point due_time() const
  {
    return std::chrono::steady_clock::now() +
      std::chrono::duration_cast<std::chrono::steady_clock::duration>(std::chrono::duration<double>(ack_delay_));
  }

  void tick()
  {
    const auto now = std::chrono::steady_clock::now();
    for (const auto & subsystem : {std::string("drive"), std::string("arm")}) {
      const auto pending = pending_modes_.find(subsystem);
      if (pending != pending_modes_.end() && pending->second.due <= now) {
        if (subsystem == "drive") drive_mode_ = pending->second.value; else arm_mode_ = pending->second.value;
        pending_modes_.erase(pending);
        publish_fma();
      }
    }
    if (pending_override_ && pending_override_->due <= now) {
      override_state_ = pending_override_->value == "ENABLE" ? "ACTIVE" : "INACTIVE";
      rover_protection_ = override_state_ != "ACTIVE";
      law_ = rover_protection_ ? "NORMAL" : "DIRECT";
      pending_override_.reset();
      publish_fma();
    }
    if (pending_gimbal_ && pending_gimbal_->due <= now) {
      gimbal_priority_ = pending_gimbal_->value;
      pending_gimbal_.reset();
      publish_fma();
    }
    for (auto iterator = rejection_clear_.begin(); iterator != rejection_clear_.end();) {
      if (iterator->second <= now) {
        rejected_modes_.erase(iterator->first);
        iterator = rejection_clear_.erase(iterator);
        publish_fma();
      } else {
        ++iterator;
      }
    }
    if (std::chrono::duration<double>(now - last_fma_).count() >= 1.0) publish_fma();
  }

  void publish_fma()
  {
    telemetry_interfaces::msg::FmaState message;
    message.schema = "dcr/fma-state/v1";
    message.sequence = ++sequence_;
    message.law = law_;
    message.system = "GOOD";
    message.drive = mode_state("drive", drive_mode_);
    message.arm = mode_state("arm", arm_mode_);
    message.arm_override.state = override_state_;
    message.arm_override.pending = pending_override_ ? pending_override_->value : "";
    message.gimbal_priority.confirmed = gimbal_priority_;
    message.gimbal_priority.pending = pending_gimbal_ ? pending_gimbal_->value : "";
    message.gimbal_priority.rejected = "";
    fma_publisher_->publish(message);
    last_fma_ = std::chrono::steady_clock::now();
  }

  telemetry_interfaces::msg::FmaModeState mode_state(
    const std::string & subsystem, const std::string & confirmed) const
  {
    telemetry_interfaces::msg::FmaModeState state;
    state.confirmed = confirmed;
    const auto pending = pending_modes_.find(subsystem);
    state.pending = pending == pending_modes_.end() ? "" : pending->second.value;
    const auto rejected = rejected_modes_.find(subsystem);
    state.rejected = rejected == rejected_modes_.end() ? "" : rejected->second;
    return state;
  }

  void publish_heartbeat() { heartbeat_publisher_->publish(std_msgs::msg::Empty{}); }

  double ack_delay_{0.15};
  std::string drive_mode_, arm_mode_, law_{"NORMAL"}, override_state_{"INACTIVE"}, gimbal_priority_;
  bool rover_protection_{true};
  uint64_t sequence_{0};
  std::chrono::steady_clock::time_point last_fma_{std::chrono::steady_clock::now()};
  std::map<std::string, Pending> pending_modes_;
  std::map<std::string, std::string> rejected_modes_;
  std::map<std::string, std::chrono::steady_clock::time_point> rejection_clear_;
  std::optional<Pending> pending_override_, pending_gimbal_;
  const std::set<std::string> drive_modes_{"MANUAL", "VELOCITY", "MANAGED"};
  const std::set<std::string> arm_modes_{"MANUAL", "POSITION", "MANAGED", "STOWED"};
  rclcpp::Publisher<telemetry_interfaces::msg::FmaState>::SharedPtr fma_publisher_;
  rclcpp::Publisher<std_msgs::msg::Empty>::SharedPtr heartbeat_publisher_;
  std::vector<rclcpp::SubscriptionBase::SharedPtr> subscriptions_;
  rclcpp::TimerBase::SharedPtr tick_timer_, heartbeat_timer_;
};

std::shared_ptr<rclcpp::Node> make_rover_control_node()
{
  return std::make_shared<RoverControlNode>();
}
}  // namespace prod_rover
