#pragma once
#include <algorithm>
#include <array>
#include <vector>
#include <ecam_alerts/reporter.hpp>
#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/bool.hpp>
#include <std_msgs/msg/int32_multi_array.hpp>

namespace rover::subsystems::drive {
class FaultMonitor {
public:
  FaultMonitor(rclcpp::Node & node, bool enabled, bool drive_is_real)
  : alerts_(node, "drive-faults"), drive_enabled_(enabled) {
    subscriptions_.push_back(node.create_subscription<std_msgs::msg::Int32MultiArray>("/telemetry/drive/fault_raw",
      rclcpp::QoS(4).reliable().transient_local(), [this](const std_msgs::msg::Int32MultiArray & message) {
        if (!drive_enabled_) return;
        if (message.data.size() != 2 || message.data[0] < 0 || message.data[0] >= 4 || message.data[1] < 0 || message.data[1] > 65535) return;
        const auto wheel = static_cast<std::size_t>(message.data[0]);
        const auto fault = message.data[1];
        drive_faults_[wheel] = fault;
        static constexpr std::array<const char *, 4> motor{"DRIVE_FL_MOTOR_FAULT", "DRIVE_RL_MOTOR_FAULT", "DRIVE_FR_MOTOR_FAULT", "DRIVE_RR_MOTOR_FAULT"};
        static constexpr std::array<const char *, 4> current{"DRIVE_FL_OVERCURRENT", "DRIVE_RL_OVERCURRENT", "DRIVE_FR_OVERCURRENT", "DRIVE_RR_OVERCURRENT"};
        static constexpr std::array<const char *, 4> temperature{"DRIVE_FL_OVERTEMPERATURE", "DRIVE_RL_OVERTEMPERATURE", "DRIVE_FR_OVERTEMPERATURE", "DRIVE_RR_OVERTEMPERATURE"};
        set(motor[wheel], fault != 0);
        set(current[wheel], fault == 1);
        set(temperature[wheel], fault == 2);
        update_drive_fault();
      }));
    if (drive_is_real) {
      subscriptions_.push_back(node.create_subscription<std_msgs::msg::Bool>("/drivetrain/communication_fault",
        rclcpp::QoS(1).reliable().transient_local(), [this](const std_msgs::msg::Bool & status) { set("DRIVE_RS485_FAULT", status.data); }));
      subscriptions_.push_back(node.create_subscription<std_msgs::msg::Bool>("/drivetrain/safety_fault",
        rclcpp::QoS(1).reliable().transient_local(), [this](const std_msgs::msg::Bool & status) {
          drive_safety_fault_ = status.data;
          update_drive_fault();
        }));
    }
  }
private:
  void set(const char * code, bool active) { if (active) alerts_.raise(code); else alerts_.clear(code); }
  void update_drive_fault() {
    set("DRIVE_DRIVETRAIN_FAULT", drive_safety_fault_ ||
      std::any_of(drive_faults_.begin(), drive_faults_.end(), [](int value) { return value > 0; }));
  }
  ecam_alerts::Reporter alerts_;
  bool drive_enabled_;
  bool drive_safety_fault_{false};
  std::array<int, 4> drive_faults_{{-1, -1, -1, -1}};
  std::vector<rclcpp::SubscriptionBase::SharedPtr> subscriptions_;
};
}
