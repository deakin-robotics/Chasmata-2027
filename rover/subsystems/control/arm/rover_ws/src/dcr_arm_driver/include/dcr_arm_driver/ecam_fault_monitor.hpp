#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <string>
#include <vector>
#include <arm_interfaces/msg/motor_stat2.hpp>
#include <can_msgs/msg/frame.hpp>
#include <ecam_alerts/reporter.hpp>
#include <rclcpp/rclcpp.hpp>
#include <telemetry_interfaces/msg/arm_control_status.hpp>

namespace rover::subsystems::arm {
class FaultMonitor {
public:
  FaultMonitor(rclcpp::Node & node, bool enabled, bool arm_is_real)
  : alerts_(node, "arm-faults"), arm_enabled_(enabled) {
    subscriptions_.push_back(node.create_subscription<arm_interfaces::msg::MotorStat2>("/telemetry/arm/motor_detail", 100,
      [this](const arm_interfaces::msg::MotorStat2 & message) {
        if (!arm_enabled_) return;
        if (message.id <= 0) return;
        arm_faults_[message.id] = message.fault_bits;
        set("ARM_JOINT_FAULT", std::any_of(arm_faults_.begin(), arm_faults_.end(),
          [](const auto & entry) { return entry.second != 0; }));
        set("ARM_OVERTEMPERATURE", std::any_of(arm_faults_.begin(), arm_faults_.end(),
          [](const auto & entry) { return (entry.second & 0x04U) != 0; }));
      }));
    subscriptions_.push_back(node.create_subscription<telemetry_interfaces::msg::ArmControlStatus>("/telemetry/arm/status", 10,
      [this](const telemetry_interfaces::msg::ArmControlStatus & status) {
        if (!arm_enabled_) return;
        const bool can_fault = status.reason.find("CAN error frame") != std::string::npos;
        const bool sensor_fault = status.reason.find("encoder feedback timeout") != std::string::npos ||
          status.reason.find("invalid or ambiguous encoder") != std::string::npos ||
          status.reason.find("invalid encoder payload") != std::string::npos;
        const bool control_fault = status.reason.rfind("latched: ", 0) == 0 &&
          status.reason.find("latched: startup") != 0;
        if (control_fault) alerts_.raise("ARM_CONTROL_FAULT");
        if (can_fault) { can_fault_active_ = true; alerts_.raise("ARM_CAN_FAULT"); }
        if (can_fault_active_ && status.motion_inhibited) can_inhibit_seen_ = true;
        if (sensor_fault) alerts_.raise("ARM_POSITION_SENSOR_INVALID");
        if (status.hardware_active && status.feedback_fresh && !status.motion_inhibited) {
          if (!control_fault) alerts_.clear("ARM_CONTROL_FAULT");
          if (!can_fault && can_inhibit_seen_) {
            alerts_.clear("ARM_CAN_FAULT");
            can_fault_active_ = false;
            can_inhibit_seen_ = false;
          }
          if (!sensor_fault) alerts_.clear("ARM_POSITION_SENSOR_INVALID");
        }
      }));
    if (arm_is_real) {
      subscriptions_.push_back(node.create_subscription<can_msgs::msg::Frame>("/socketcan_bridge/rx", 100,
        [this](const can_msgs::msg::Frame & frame) {
          if (frame.is_error) { can_fault_active_ = true; can_inhibit_seen_ = false; alerts_.raise("ARM_CAN_FAULT"); }
        }));
    }
  }
private:
  void set(const char * code, bool active) { if (active) alerts_.raise(code); else alerts_.clear(code); }
  ecam_alerts::Reporter alerts_;
  bool arm_enabled_;
  bool can_fault_active_{false}, can_inhibit_seen_{false};
  std::map<std::int64_t, std::uint8_t> arm_faults_;
  std::vector<rclcpp::SubscriptionBase::SharedPtr> subscriptions_;
};
}
