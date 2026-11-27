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
#include <ecam_alerts/reporter.hpp>
#include <dcr_arm_driver/ecam_fault_monitor.hpp>
#include <rover_drivetrain_control/ecam_fault_monitor.hpp>
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
  : owner_(node), alerts_(node, "rover-health"), arm_fault_monitor_(node, arm_enabled, arm_is_real), drive_fault_monitor_(node, drive_enabled, drive_is_real), arm_enabled_(arm_enabled), drive_enabled_(drive_enabled), require_estop_(require_estop), started_(Clock::now())
  {
    subscriptions_.push_back(node.create_subscription<telemetry_interfaces::msg::ArmControlStatus>("/telemetry/arm/status", 10,
      [this](const telemetry_interfaces::msg::ArmControlStatus & status) {
        if (!arm_enabled_) return;
        last_arm_status_ = Clock::now();
        arm_feedback_valid_ = status.hardware_active && status.feedback_fresh;
      }));
    subscriptions_.push_back(node.create_subscription<std_msgs::msg::Bool>("/estop", 10,
      [this](const std_msgs::msg::Bool & status) {
        last_estop_ = Clock::now();
        set("SYSTEM_ESTOP_ACTIVE", status.data);
        alerts_.clear("SYSTEM_ESTOP_UNAVAILABLE");
      }));
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
        if (status.state == "FAILED") alerts_.raise("ARM_POSITION_REQUEST_FAILED");
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
  void set(const char * code, bool active) { if (active) alerts_.raise(code); else alerts_.clear(code); }
  using Clock = std::chrono::steady_clock;
  ecam_alerts::RoverAlertOwner owner_;
  ecam_alerts::Reporter alerts_;
  rover::subsystems::arm::FaultMonitor arm_fault_monitor_;
  rover::subsystems::drive::FaultMonitor drive_fault_monitor_;
  bool arm_enabled_, drive_enabled_, require_estop_;
  bool arm_feedback_valid_{false};
  Clock::time_point started_, last_arm_{}, last_arm_status_{}, last_drive_{}, last_estop_{};
  std::vector<rclcpp::SubscriptionBase::SharedPtr> subscriptions_;
  rclcpp::TimerBase::SharedPtr timer_;
};
}
