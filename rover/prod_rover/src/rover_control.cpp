#include "prod_rover/rover_control.hpp"

#include <algorithm>
#include <chrono>
#include <cctype>
#include <map>
#include <optional>
#include <set>
#include <string>

#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/empty.hpp>
#include <std_msgs/msg/string.hpp>
#include <telemetry_interfaces/msg/arm_control_status.hpp>
#include <telemetry_interfaces/msg/fma_state.hpp>

#include "prod_rover/srv/set_arm_control_mode.hpp"

namespace prod_rover
{
namespace
{
std::string normalized(std::string value)
{
  const auto first = value.find_first_not_of(" \t\r\n");
  const auto last = value.find_last_not_of(" \t\r\n");
  value = first == std::string::npos ? "" : value.substr(first, last - first + 1);
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
    return static_cast<char>(std::toupper(c));
  });
  return value;
}
}  // namespace

class RoverControlNode final : public rclcpp::Node
{
public:
  RoverControlNode() : Node("rover_control")
  {
    declare_parameter<double>("mode_ack_delay_ms", 150.0);
    const auto retained = rclcpp::QoS(rclcpp::KeepLast(1)).reliable().transient_local();
    fma_pub_ = create_publisher<telemetry_interfaces::msg::FmaState>("/fma/state", retained);
    heartbeat_pub_ = create_publisher<std_msgs::msg::Empty>("/rover/heartbeat", retained);
    arm_mode_client_ = create_client<SetArmControlMode>("/arm/control/set_mode");
    arm_request_sub_ = create_subscription<std_msgs::msg::String>("/fma/arm/request", 10,
      [this](const std_msgs::msg::String::SharedPtr message) { request_arm(message->data); });
    drive_request_sub_ = create_subscription<std_msgs::msg::String>("/fma/drive/request", 10,
      [this](const std_msgs::msg::String::SharedPtr message) { request_timer_mode("drive", message->data); });
    override_sub_ = create_subscription<std_msgs::msg::String>("/arm/override/request", 10,
      [this](const std_msgs::msg::String::SharedPtr message) { request_override(message->data); });
    gimbal_sub_ = create_subscription<std_msgs::msg::String>("/fma/gimbal/request", 10,
      [this](const std_msgs::msg::String::SharedPtr message) { request_gimbal(message->data); });
    health_sub_ = create_subscription<telemetry_interfaces::msg::ArmControlStatus>("/arm/control/status", retained,
      [this](const telemetry_interfaces::msg::ArmControlStatus::SharedPtr message) {
        arm_health_ = *message;
        have_arm_health_ = true;
        publish_fma();
      });
    const auto delay = std::chrono::milliseconds(static_cast<int>(get_parameter("mode_ack_delay_ms").as_double()));
    ack_delay_ = std::max(delay, std::chrono::milliseconds(0));
    timer_ = create_wall_timer(std::chrono::milliseconds(25), [this]() { tick(); });
    heartbeat_timer_ = create_wall_timer(std::chrono::seconds(1), [this]() { heartbeat_pub_->publish(std_msgs::msg::Empty{}); });
    publish_fma();
    heartbeat_pub_->publish(std_msgs::msg::Empty{});
  }

private:
  using SetArmControlMode = prod_rover::srv::SetArmControlMode;
  struct Pending { std::string value; std::chrono::steady_clock::time_point due; };
  struct PendingArm { std::string value; rclcpp::Client<SetArmControlMode>::SharedFuture future; std::chrono::steady_clock::time_point deadline; };

  void request_arm(const std::string & raw)
  {
    const auto mode = normalized(raw);
    if (arm_modes_.count(mode) == 0) { reject("arm", mode); return; }
    rejected_.erase("arm");
    if (mode == "MANUAL" || mode == "POSITION") {
      if (!arm_mode_client_->service_is_ready()) {
        reject("arm", mode);
      } else {
        auto request = std::make_shared<SetArmControlMode::Request>();
        request->mode = mode;
        auto future_and_id = arm_mode_client_->async_send_request(request);
        pending_arm_ = PendingArm{mode, future_and_id.future.share(), std::chrono::steady_clock::now() + std::chrono::seconds(3)};
      }
    } else {
      pending_["arm"] = Pending{mode, std::chrono::steady_clock::now() + ack_delay_};
    }
    publish_fma();
  }

  void request_timer_mode(const std::string & subsystem, const std::string & raw)
  {
    const auto mode = normalized(raw);
    if (drive_modes_.count(mode) == 0) { reject(subsystem, mode); return; }
    rejected_.erase(subsystem);
    pending_[subsystem] = Pending{mode, std::chrono::steady_clock::now() + ack_delay_};
    publish_fma();
  }

  void request_override(const std::string & raw)
  {
    const auto command = normalized(raw);
    if (command == "ENABLE" || command == "DISABLE") pending_override_ = Pending{command, std::chrono::steady_clock::now() + ack_delay_};
    publish_fma();
  }

  void request_gimbal(const std::string & raw)
  {
    const auto owner = normalized(raw);
    if (owner == "DRIVER" || owner == "ARM OPS") pending_gimbal_ = Pending{owner, std::chrono::steady_clock::now() + ack_delay_};
    publish_fma();
  }

  void reject(const std::string & subsystem, const std::string & value)
  {
    pending_.erase(subsystem);
    if (subsystem == "arm") pending_arm_.reset();
    rejected_[subsystem] = value;
    rejection_clear_[subsystem] = std::chrono::steady_clock::now() + std::chrono::milliseconds(500);
    publish_fma();
  }

  void tick()
  {
    const auto now = std::chrono::steady_clock::now();
    if (pending_arm_) {
      if (pending_arm_->future.wait_for(std::chrono::seconds(0)) == std::future_status::ready) {
        const auto response = pending_arm_->future.get();
        const auto requested = pending_arm_->value;
        pending_arm_.reset();
        if (response->success) arm_mode_ = requested; else reject("arm", requested);
        publish_fma();
      } else if (now >= pending_arm_->deadline) {
        const auto requested = pending_arm_->value;
        pending_arm_.reset();
        reject("arm", requested);
      }
    }
    for (auto iterator = pending_.begin(); iterator != pending_.end();) {
      if (iterator->second.due <= now) {
        if (iterator->first == "drive") drive_mode_ = iterator->second.value; else arm_mode_ = iterator->second.value;
        iterator = pending_.erase(iterator);
        publish_fma();
      } else ++iterator;
    }
    if (pending_override_ && pending_override_->due <= now) {
      override_state_ = pending_override_->value == "ENABLE" ? "ACTIVE" : "INACTIVE";
      law_ = override_state_ == "ACTIVE" ? "DIRECT" : "NORMAL";
      pending_override_.reset(); publish_fma();
    }
    if (pending_gimbal_ && pending_gimbal_->due <= now) { gimbal_ = pending_gimbal_->value; pending_gimbal_.reset(); publish_fma(); }
    for (auto iterator = rejection_clear_.begin(); iterator != rejection_clear_.end();) {
      if (iterator->second <= now) { rejected_.erase(iterator->first); iterator = rejection_clear_.erase(iterator); publish_fma(); } else ++iterator;
    }
    if (now - last_fma_ >= std::chrono::seconds(1)) publish_fma();
  }

  telemetry_interfaces::msg::FmaModeState mode_state(const std::string & name, const std::string & confirmed) const
  {
    telemetry_interfaces::msg::FmaModeState result;
    result.confirmed = confirmed;
    const auto pending = pending_.find(name);
    result.pending = pending == pending_.end() ? "" : pending->second.value;
    if (name == "arm" && pending_arm_) result.pending = pending_arm_->value;
    const auto rejected = rejected_.find(name);
    result.rejected = rejected == rejected_.end() ? "" : rejected->second;
    return result;
  }

  std::string system_state() const
  {
    if (!have_arm_health_) return "DEGRADED";
    if (!arm_health_.estop_clear) return "E-STOP";
    if (!arm_health_.hardware_active || !arm_health_.feedback_fresh || !arm_health_.motor_status_safe) return "FAULT";
    if (arm_health_.motion_inhibited || !arm_health_.controller_ready) return "DEGRADED";
    return "GOOD";
  }

  void publish_fma()
  {
    telemetry_interfaces::msg::FmaState state;
    state.schema = "dcr/fma-state/v1";
    state.sequence = ++sequence_;
    state.drive = mode_state("drive", drive_mode_);
    state.arm = mode_state("arm", arm_mode_);
    state.law = law_;
    state.arm_override.state = override_state_;
    state.arm_override.pending = pending_override_ ? pending_override_->value : "";
    state.gimbal_priority.confirmed = gimbal_;
    state.gimbal_priority.pending = pending_gimbal_ ? pending_gimbal_->value : "";
    state.system = system_state();
    fma_pub_->publish(state);
    last_fma_ = std::chrono::steady_clock::now();
  }

  const std::set<std::string> drive_modes_{"MANUAL", "VELOCITY", "MANAGED"};
  const std::set<std::string> arm_modes_{"MANUAL", "POSITION", "MANAGED", "STOWED"};
  std::chrono::milliseconds ack_delay_{150};
  std::string drive_mode_, arm_mode_, law_{"NORMAL"}, override_state_{"INACTIVE"}, gimbal_;
  uint64_t sequence_{0}; bool have_arm_health_{false}; telemetry_interfaces::msg::ArmControlStatus arm_health_;
  std::map<std::string, Pending> pending_; std::optional<PendingArm> pending_arm_; std::optional<Pending> pending_override_, pending_gimbal_;
  std::map<std::string, std::string> rejected_; std::map<std::string, std::chrono::steady_clock::time_point> rejection_clear_;
  std::chrono::steady_clock::time_point last_fma_{std::chrono::steady_clock::now()};
  rclcpp::Publisher<telemetry_interfaces::msg::FmaState>::SharedPtr fma_pub_;
  rclcpp::Publisher<std_msgs::msg::Empty>::SharedPtr heartbeat_pub_;
  rclcpp::Subscription<std_msgs::msg::String>::SharedPtr arm_request_sub_, drive_request_sub_, override_sub_, gimbal_sub_;
  rclcpp::Subscription<telemetry_interfaces::msg::ArmControlStatus>::SharedPtr health_sub_;
  rclcpp::Client<SetArmControlMode>::SharedPtr arm_mode_client_;
  rclcpp::TimerBase::SharedPtr timer_, heartbeat_timer_;
};

std::shared_ptr<rclcpp::Node> make_rover_control_node() { return std::make_shared<RoverControlNode>(); }
}  // namespace prod_rover
