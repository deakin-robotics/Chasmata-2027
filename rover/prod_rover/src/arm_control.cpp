#include "prod_rover/arm_control.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <memory>
#include <string>

#include <controller_manager_msgs/srv/switch_controller.hpp>
#include <dcr_arm_driver/msg/direct_drive.hpp>
#include <ecam_alerts/source.hpp>
#include <rclcpp/rclcpp.hpp>
#include <sensor_msgs/msg/joy.hpp>
#include <std_msgs/msg/bool.hpp>
#include <telemetry_interfaces/msg/arm_control_status.hpp>
#include <telemetry_interfaces/msg/fma_state.hpp>

#include "prod_rover/srv/set_arm_control_mode.hpp"

namespace prod_rover
{
namespace
{
constexpr std::array<uint32_t, 6> kJointIds{0x01, 0x02, 0x03, 0x04, 0x05, 0x06};
constexpr std::array<size_t, 6> kManualAxes{0, 1, 4, 6, 7, 0};
}  // namespace

class ArmControlNode final : public rclcpp::Node
{
public:
  ArmControlNode() : Node("arm_control"), alerts_(*this, "arm")
  {
    declare_parameter<double>("manual_speed_rpm", 5.0);
    manual_speed_rpm_ = std::max(0.0, get_parameter("manual_speed_rpm").as_double());
    direct_pub_ = create_publisher<dcr_arm_driver::msg::DirectDrive>("/arm/direct_drive", 10);
    switch_client_ = create_client<controller_manager_msgs::srv::SwitchController>("/controller_manager/switch_controller");
    health_sub_ = create_subscription<telemetry_interfaces::msg::ArmControlStatus>("/arm/control/status",
      rclcpp::QoS(rclcpp::KeepLast(1)).reliable().transient_local(),
      [this](const telemetry_interfaces::msg::ArmControlStatus::SharedPtr message) { health_ = *message; have_health_ = true; update_alerts(); });
    fma_sub_ = create_subscription<telemetry_interfaces::msg::FmaState>("/fma/state", 10,
      [this](const telemetry_interfaces::msg::FmaState::SharedPtr message) { arm_mode_ = message->arm.confirmed; });
    joy_sub_ = create_subscription<sensor_msgs::msg::Joy>("/arm/joy", 10,
      [this](const sensor_msgs::msg::Joy::SharedPtr message) { on_joy(*message); });
    lock_sub_ = create_subscription<std_msgs::msg::Bool>("/arm/orientation_lock", 10,
      [this](const std_msgs::msg::Bool::SharedPtr message) { orientation_locked_ = message->data; if (orientation_locked_) release_wrist_to_controller(); });
    service_ = create_service<SetArmControlMode>("/arm/control/set_mode",
      [this](const SetArmControlMode::Request::SharedPtr request, SetArmControlMode::Response::SharedPtr response) {
        set_mode(request->mode, *response);
      });
    recovery_timer_ = create_wall_timer(std::chrono::seconds(1), [this]() { alerts_.publish_snapshot(); update_alerts(); });
  }

private:
  using SetArmControlMode = prod_rover::srv::SetArmControlMode;

  bool healthy(bool require_trajectory_ready, std::string & reason) const
  {
    if (!have_health_) { reason = "arm health telemetry unavailable"; return false; }
    if (!health_.hardware_active) { reason = "arm hardware inactive"; return false; }
    if (!health_.estop_clear) { reason = "e-stop active or unknown"; return false; }
    if (!health_.feedback_fresh || !health_.motor_status_safe) { reason = health_.reason; return false; }
    if (require_trajectory_ready && (health_.motion_inhibited || !health_.controller_ready)) { reason = health_.reason; return false; }
    return true;
  }

  bool switch_controller(bool activate, std::string & reason)
  {
    if (!switch_client_->wait_for_service(std::chrono::seconds(1))) { reason = "controller manager unavailable"; return false; }
    auto request = std::make_shared<controller_manager_msgs::srv::SwitchController::Request>();
    if (activate) request->activate_controllers = {"arm_controller"}; else request->deactivate_controllers = {"arm_controller"};
    request->strictness = controller_manager_msgs::srv::SwitchController::Request::STRICT;
    request->activate_asap = false;
    request->timeout.sec = 2;
    auto future_and_id = switch_client_->async_send_request(request);
    auto future = future_and_id.future.share();
    if (future.wait_for(std::chrono::seconds(3)) != std::future_status::ready || !future.get()->ok) { reason = "arm controller transition failed"; return false; }
    return true;
  }

  void set_mode(const std::string & mode, SetArmControlMode::Response & response)
  {
    std::string reason;
    if (mode != "MANUAL" && mode != "POSITION") { response.reason = "unsupported arm control mode"; return; }
    if (!healthy(mode == "POSITION", reason)) { response.reason = reason; return; }
    if (!switch_controller(mode == "POSITION", reason)) { response.reason = reason; return; }
    if (mode == "MANUAL") set_all_direct_speed(0.0); else release_all_to_controller();
    response.success = true;
    response.reason = "ready";
  }

  void publish_direct(uint32_t id, uint8_t mode, double value)
  {
    dcr_arm_driver::msg::DirectDrive command;
    command.id = id; command.mode = mode; command.value = value;
    direct_pub_->publish(command);
  }

  void set_all_direct_speed(double speed)
  {
    for (const auto id : kJointIds) publish_direct(id, dcr_arm_driver::msg::DirectDrive::SPEED, speed);
  }

  void release_all_to_controller()
  {
    for (const auto id : kJointIds) publish_direct(id, dcr_arm_driver::msg::DirectDrive::CONTROLLER, 0.0);
  }

  void release_wrist_to_controller()
  {
    for (size_t index = 3; index < kJointIds.size(); ++index) publish_direct(kJointIds[index], dcr_arm_driver::msg::DirectDrive::CONTROLLER, 0.0);
  }

  void on_joy(const sensor_msgs::msg::Joy & message)
  {
    if (message.axes.size() <= 9 || (message.buttons.size() > 4 && (message.buttons[4] < 0 || message.buttons[4] > 1))) return;
    const auto trigger_delta = message.axes[9] - message.axes[8];
    if (!std::isfinite(trigger_delta)) return;
    if (arm_mode_ == "MANUAL") {
      const bool gimbal_held = message.buttons.size() > 4 && message.buttons[4] != 0;
      const std::array<double, 6> axes{message.axes[0], message.axes[1], gimbal_held ? 0.0 : message.axes[4], message.axes[6], message.axes[7], trigger_delta};
      for (size_t index = 0; index < axes.size(); ++index) if (std::isfinite(axes[index])) publish_direct(kJointIds[index], dcr_arm_driver::msg::DirectDrive::SPEED, axes[index] * manual_speed_rpm_);
    } else if (arm_mode_ == "POSITION" && !orientation_locked_) {
      const std::array<double, 3> axes{message.axes[6], message.axes[7], trigger_delta};
      for (size_t index = 0; index < axes.size(); ++index) if (std::isfinite(axes[index])) publish_direct(kJointIds[index + 3], dcr_arm_driver::msg::DirectDrive::SPEED, axes[index] * manual_speed_rpm_);
    }
  }

  void update_alerts()
  {
    if (!have_health_) { alerts_.raise_alert("ARM_TELEMETRY_UNAVAILABLE"); return; }
    if (!health_.hardware_active) alerts_.raise_alert("ARM_CAN_FAULT"); else alerts_.clear("ARM_CAN_FAULT");
    if (!health_.feedback_fresh) alerts_.raise_alert("ARM_POSITION_SENSOR_INVALID"); else alerts_.clear("ARM_POSITION_SENSOR_INVALID");
    if (!health_.motor_status_safe) alerts_.raise_alert("ARM_JOINT_FAULT"); else alerts_.clear("ARM_JOINT_FAULT");
    if (health_.motion_inhibited) alerts_.raise_alert("ARM_PROTECTION_UNAVAILABLE"); else alerts_.clear("ARM_PROTECTION_UNAVAILABLE");
    if (health_.hardware_active && health_.feedback_fresh && health_.motor_status_safe) alerts_.clear("ARM_TELEMETRY_UNAVAILABLE");
  }

  double manual_speed_rpm_{5.0}; bool have_health_{false}; bool orientation_locked_{false}; std::string arm_mode_;
  telemetry_interfaces::msg::ArmControlStatus health_;
  ecam_alerts::EcamAlertSource alerts_;
  rclcpp::Publisher<dcr_arm_driver::msg::DirectDrive>::SharedPtr direct_pub_;
  rclcpp::Subscription<telemetry_interfaces::msg::ArmControlStatus>::SharedPtr health_sub_;
  rclcpp::Subscription<telemetry_interfaces::msg::FmaState>::SharedPtr fma_sub_;
  rclcpp::Subscription<sensor_msgs::msg::Joy>::SharedPtr joy_sub_;
  rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr lock_sub_;
  rclcpp::Client<controller_manager_msgs::srv::SwitchController>::SharedPtr switch_client_;
  rclcpp::Service<SetArmControlMode>::SharedPtr service_;
  rclcpp::TimerBase::SharedPtr recovery_timer_;
};

std::shared_ptr<rclcpp::Node> make_arm_control_node() { return std::make_shared<ArmControlNode>(); }
}  // namespace prod_rover
