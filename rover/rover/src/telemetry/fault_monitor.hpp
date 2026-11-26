#pragma once

#include <algorithm>
#include <array>
#include <chrono>
#include <cstdint>
#include <cmath>
#include <map>
#include <string>
#include <vector>
#include <arm_interfaces/msg/motor_stat2.hpp>
#include <can_msgs/msg/frame.hpp>
#include <ecam_alerts/source.hpp>
#include <rclcpp/rclcpp.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <std_msgs/msg/bool.hpp>
#include <std_msgs/msg/int32_multi_array.hpp>
#include <telemetry_interfaces/msg/arm_control_status.hpp>
#include <telemetry_interfaces/msg/arm_move_it_status.hpp>

namespace rover::telemetry
{
// One Rover source owns the combined ARM and DRIVE alert set.
class FaultMonitor
{
public:
  explicit FaultMonitor(rclcpp::Node & node, bool arm_enabled = true, bool drive_enabled = true,
    bool require_estop = false, bool arm_is_real = false, bool drive_is_real = false)
  : alerts_(node, "rover"), arm_enabled_(arm_enabled), drive_enabled_(drive_enabled), require_estop_(require_estop), started_(Clock::now())
  {
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
    subscriptions_.push_back(node.create_subscription<telemetry_interfaces::msg::ArmControlStatus>("/telemetry/arm/status", 10,
      [this](const telemetry_interfaces::msg::ArmControlStatus & status) {
        if (!arm_enabled_) return;
        last_arm_status_ = Clock::now();
        arm_feedback_valid_ = status.hardware_active && status.feedback_fresh;
        const bool can_fault = status.reason.find("CAN error frame") != std::string::npos;
        const bool sensor_fault = status.reason.find("encoder feedback timeout") != std::string::npos ||
          status.reason.find("invalid or ambiguous encoder") != std::string::npos ||
          status.reason.find("invalid encoder payload") != std::string::npos;
        const bool control_fault = status.reason.rfind("latched: ", 0) == 0 &&
          status.reason.find("latched: startup") != 0;
        if (control_fault) alerts_.raise_alert("ARM_CONTROL_FAULT");
        if (can_fault) { can_fault_active_ = true; alerts_.raise_alert("ARM_CAN_FAULT"); }
        if (can_fault_active_ && status.motion_inhibited) can_inhibit_seen_ = true;
        if (sensor_fault) alerts_.raise_alert("ARM_POSITION_SENSOR_INVALID");
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
    subscriptions_.push_back(node.create_subscription<std_msgs::msg::Bool>("/estop", 10,
      [this](const std_msgs::msg::Bool & status) {
        last_estop_ = Clock::now();
        set("SYSTEM_ESTOP_ACTIVE", status.data);
        alerts_.clear("SYSTEM_ESTOP_UNAVAILABLE");
      }));
    if (arm_is_real) {
      subscriptions_.push_back(node.create_subscription<can_msgs::msg::Frame>("/socketcan_bridge/rx", 100,
        [this](const can_msgs::msg::Frame & frame) {
          if (frame.is_error) { can_fault_active_ = true; can_inhibit_seen_ = false; alerts_.raise_alert("ARM_CAN_FAULT"); }
        }));
    }
    if (drive_is_real) {
      subscriptions_.push_back(node.create_subscription<std_msgs::msg::Bool>("/drivetrain/communication_fault",
        rclcpp::QoS(1).reliable().transient_local(), [this](const std_msgs::msg::Bool & status) { set("DRIVE_RS485_FAULT", status.data); }));
      subscriptions_.push_back(node.create_subscription<std_msgs::msg::Bool>("/drivetrain/safety_fault",
        rclcpp::QoS(1).reliable().transient_local(), [this](const std_msgs::msg::Bool & status) {
          drive_safety_fault_ = status.data;
          update_drive_fault();
        }));
    }
    subscriptions_.push_back(node.create_subscription<sensor_msgs::msg::JointState>("/telemetry/arm/joint_states", 10,
      [this](const sensor_msgs::msg::JointState & value) {
        if (!value.name.empty() && value.name.size() == value.position.size() &&
            std::all_of(value.position.begin(), value.position.end(), [](double sample) { return std::isfinite(sample); })) last_arm_ = Clock::now();
      }));
    subscriptions_.push_back(node.create_subscription<sensor_msgs::msg::JointState>("/telemetry/drive/joint_states", 10,
      [this](const sensor_msgs::msg::JointState & value) {
        if (!value.name.empty() && value.name.size() == value.velocity.size() &&
            std::all_of(value.velocity.begin(), value.velocity.end(), [](double sample) { return std::isfinite(sample); })) last_drive_ = Clock::now();
      }));
    subscriptions_.push_back(node.create_subscription<telemetry_interfaces::msg::ArmMoveItStatus>("/arm/moveit/status", 10,
      [this](const telemetry_interfaces::msg::ArmMoveItStatus & status) {
        if (!arm_enabled_) return;
        if (status.state == "FAILED") alerts_.raise_alert("ARM_POSITION_REQUEST_FAILED");
        else if (status.state == "SUCCEEDED") alerts_.clear("ARM_POSITION_REQUEST_FAILED");
      }));
    timer_ = node.create_wall_timer(std::chrono::milliseconds(500), [this] {
      const auto now = Clock::now();
      if (arm_enabled_) set("ARM_TELEMETRY_UNAVAILABLE", now - (last_arm_ == Clock::time_point{} ? started_ : last_arm_) > std::chrono::seconds(3) ||
        (last_arm_status_ != Clock::time_point{} && (!arm_feedback_valid_ || now - last_arm_status_ > std::chrono::seconds(2))) ||
        (last_arm_status_ == Clock::time_point{} && now - started_ > std::chrono::seconds(3)));
      if (drive_enabled_) set("DRIVE_TELEMETRY_UNAVAILABLE", now - (last_drive_ == Clock::time_point{} ? started_ : last_drive_) > std::chrono::seconds(3));
      if (require_estop_) set("SYSTEM_ESTOP_UNAVAILABLE", now - (last_estop_ == Clock::time_point{} ? started_ : last_estop_) > std::chrono::milliseconds(600));
    });
  }
private:
  void set(const char * code, bool active) { if (active) alerts_.raise_alert(code); else alerts_.clear(code); }
  void update_drive_fault() {
    set("DRIVE_DRIVETRAIN_FAULT", drive_safety_fault_ ||
      std::any_of(drive_faults_.begin(), drive_faults_.end(), [](int value) { return value > 0; }));
  }
  using Clock = std::chrono::steady_clock;
  ecam_alerts::EcamAlertSource alerts_;
  bool arm_enabled_, drive_enabled_, require_estop_;
  bool arm_feedback_valid_{false};
  bool can_fault_active_{false}, can_inhibit_seen_{false};
  bool drive_safety_fault_{false};
  Clock::time_point started_, last_arm_{}, last_arm_status_{}, last_drive_{}, last_estop_{};
  std::map<std::int64_t, std::uint8_t> arm_faults_;
  std::array<int, 4> drive_faults_{{-1, -1, -1, -1}};
  std::vector<rclcpp::SubscriptionBase::SharedPtr> subscriptions_;
  rclcpp::TimerBase::SharedPtr timer_;
};
}
