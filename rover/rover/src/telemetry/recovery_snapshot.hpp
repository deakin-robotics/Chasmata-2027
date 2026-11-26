#pragma once

#include <array>
#include <chrono>
#include <map>
#include <mutex>
#include <vector>
#include <arm_interfaces/msg/motor_stat1.hpp>
#include <arm_interfaces/msg/motor_stat2.hpp>
#include <dcr_arm_driver/msg/direct_drive.hpp>
#include <geometry_msgs/msg/twist_stamped.hpp>
#include <nav_msgs/msg/odometry.hpp>
#include <rclcpp/rclcpp.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <std_msgs/msg/int32_multi_array.hpp>
#include <std_msgs/msg/bool.hpp>
#include <telemetry_interfaces/msg/recovery_snapshot.hpp>

namespace rover::telemetry
{
// The snapshot is read-only; it never republishes commands to control topics.
class RecoverySnapshot
{
  using Clock = std::chrono::steady_clock;
  template<typename T> struct Sample { T value{}; Clock::time_point received{}; };
  template<typename T> static bool fresh(const Sample<T> & value, std::chrono::milliseconds age)
  {
    return value.received != Clock::time_point{} && Clock::now() - value.received < age;
  }
public:
  explicit RecoverySnapshot(rclcpp::Node & node) : node_(node)
  {
    auto qos = rclcpp::QoS(rclcpp::KeepLast(1)).reliable().transient_local();
    publisher_ = node.create_publisher<telemetry_interfaces::msg::RecoverySnapshot>("/telemetry/recovery_snapshot", qos);
    subscribe<telemetry_interfaces::msg::FmaState>("/fma/state", qos, fma_);
    subscribe<telemetry_interfaces::msg::EcamAlerts>("/ecam/alerts", qos, ecam_);
    subscribe<sensor_msgs::msg::JointState>("/telemetry/arm/joint_states", 10, arm_joints_);
    subscribe<telemetry_interfaces::msg::ArmControlStatus>("/telemetry/arm/status", 10, arm_status_);
    subscribe<telemetry_interfaces::msg::ArmMoveItStatus>("/arm/moveit/status", 10, arm_planner_);
    subscribe<std_msgs::msg::Bool>("/estop", 10, estop_);
    subscribe<sensor_msgs::msg::JointState>("/telemetry/arm/trajectory_commands", 10, arm_trajectory_);
    subscribe<sensor_msgs::msg::JointState>("/telemetry/drive/joint_states", 10, drive_joints_);
    subscribe<sensor_msgs::msg::JointState>("/telemetry/drive/commands", 10, drive_commands_);
    subscribe<nav_msgs::msg::Odometry>("/telemetry/drive/odometry", 10, drive_odometry_);
    subscribe<geometry_msgs::msg::TwistStamped>("/telemetry/drive/linear_command", 10, drive_linear_command_);
    subscriptions_.push_back(node.create_subscription<arm_interfaces::msg::MotorStat1>("/telemetry/arm/motor_status", 100,
      [this](const arm_interfaces::msg::MotorStat1 & value) {
        std::lock_guard<std::mutex> lock(mutex_); motors_[value.id] = {value, Clock::now()};
      }));
    subscriptions_.push_back(node.create_subscription<arm_interfaces::msg::MotorStat2>("/telemetry/arm/motor_detail", 100,
      [this](const arm_interfaces::msg::MotorStat2 & value) {
        std::lock_guard<std::mutex> lock(mutex_); motor_details_[value.id] = {value, Clock::now()};
      }));
    subscriptions_.push_back(node.create_subscription<dcr_arm_driver::msg::DirectDrive>("/telemetry/arm/commands", 100,
      [this](const dcr_arm_driver::msg::DirectDrive & value) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (value.mode == dcr_arm_driver::msg::DirectDrive::CONTROLLER) commands_.erase(value.id);
        else commands_[value.id] = {value, Clock::now()};
      }));
    subscriptions_.push_back(node.create_subscription<std_msgs::msg::Int32MultiArray>("/telemetry/drive/temperature_raw", 10,
      [this](const std_msgs::msg::Int32MultiArray & value) {
        if (value.data.size() != 2 || value.data[0] < 0 || value.data[0] >= 4) return;
        std::lock_guard<std::mutex> lock(mutex_);
        const auto wheel = static_cast<std::size_t>(value.data[0]);
        temperatures_[wheel] = {value.data[1], value.data[1] < 0 ? Clock::time_point{} : Clock::now()};
      }));
    subscriptions_.push_back(node.create_subscription<std_msgs::msg::Int32MultiArray>("/telemetry/drive/current_raw", 10,
      [this](const std_msgs::msg::Int32MultiArray & value) {
        if (value.data.size() != 2 || value.data[0] < 0 || value.data[0] >= 4) return;
        std::lock_guard<std::mutex> lock(mutex_);
        const auto wheel = static_cast<std::size_t>(value.data[0]);
        currents_[wheel] = {value.data[1], value.data[1] < 0 ? Clock::time_point{} : Clock::now()};
      }));
    timer_ = node.create_wall_timer(std::chrono::seconds(1), [this] { publish(); });
  }
private:
  template<typename T, typename Q> void subscribe(const std::string & topic, const Q & qos, Sample<T> & target)
  {
    subscriptions_.push_back(node_.create_subscription<T>(topic, qos, [this, &target](const T & value) {
      std::lock_guard<std::mutex> lock(mutex_); target = {value, Clock::now()};
    }));
  }
  void publish()
  {
    using namespace std::chrono_literals;
    telemetry_interfaces::msg::RecoverySnapshot output;
    output.timestamp = node_.now();
    std::lock_guard<std::mutex> lock(mutex_);
    output.fma_valid = fresh(fma_, 2500ms); if (output.fma_valid) output.fma = fma_.value;
    output.ecam_valid = fresh(ecam_, 3500ms); if (output.ecam_valid) output.ecam = ecam_.value;
    output.arm_joint_valid = fresh(arm_joints_, 1000ms); if (output.arm_joint_valid) output.arm_joints = arm_joints_.value;
    output.arm_status_valid = fresh(arm_status_, 2000ms); if (output.arm_status_valid) output.arm_status = arm_status_.value;
    output.arm_planner_valid = fresh(arm_planner_, 20000ms); if (output.arm_planner_valid) output.arm_planner = arm_planner_.value;
    output.global_estop_valid = fresh(estop_, 600ms); if (output.global_estop_valid) output.global_estop_asserted = estop_.value.data;
    output.arm_trajectory_valid = fresh(arm_trajectory_, 1500ms); if (output.arm_trajectory_valid) output.arm_trajectory = arm_trajectory_.value;
    output.drive_joint_valid = fresh(drive_joints_, 1500ms); if (output.drive_joint_valid) output.drive_joints = drive_joints_.value;
    output.drive_command_valid = fresh(drive_commands_, 1500ms); if (output.drive_command_valid) output.drive_commands = drive_commands_.value;
    output.drive_odometry_valid = fresh(drive_odometry_, 1500ms); if (output.drive_odometry_valid) output.drive_odometry = drive_odometry_.value;
    output.drive_linear_command_valid = fresh(drive_linear_command_, 1500ms); if (output.drive_linear_command_valid) output.drive_linear_command = drive_linear_command_.value;
    for (const auto & [id, sample] : motors_) if (fresh(sample, 2500ms)) {
      telemetry_interfaces::msg::RecoveryMotorStatus motor;
      motor.id = id; motor.temperature = sample.value.temp; motor.current = sample.value.current;
      motor.speed = sample.value.speed; motor.angle = sample.value.angle;
      output.arm_motors.push_back(motor);
    }
    for (const auto & [id, sample] : motor_details_) if (fresh(sample, 2500ms)) {
      telemetry_interfaces::msg::RecoveryMotorDetail detail;
      detail.id = id; detail.bus_voltage = sample.value.busv; detail.bus_current = sample.value.busc; detail.mode = sample.value.mode;
      output.arm_motor_details.push_back(detail);
    }
    for (const auto & [id, sample] : commands_) if (fresh(sample, 1500ms)) {
      telemetry_interfaces::msg::RecoveryArmCommand command;
      command.id = id; command.mode = sample.value.mode; command.value = sample.value.value;
      output.arm_commands.push_back(command);
    }
    for (std::size_t i = 0; i < temperatures_.size(); ++i) {
      output.drive_temperature_valid[i] = fresh(temperatures_[i], 10000ms);
      if (output.drive_temperature_valid[i]) output.drive_temperature_raw[i] = temperatures_[i].value;
      output.drive_current_valid[i] = fresh(currents_[i], 10000ms);
      if (output.drive_current_valid[i]) output.drive_current_raw[i] = currents_[i].value;
    }
    output.unavailable_fields = {"power", "link", "camera", "system_diagnostics", "takeoff_config",
      "watchdog", "ecam_source_liveness", "arm_can_health", "arm_joint_limits"};
    publisher_->publish(output);
  }
  rclcpp::Node & node_;
  std::mutex mutex_;
  Sample<telemetry_interfaces::msg::FmaState> fma_;
  Sample<telemetry_interfaces::msg::EcamAlerts> ecam_;
  Sample<sensor_msgs::msg::JointState> arm_joints_, arm_trajectory_, drive_joints_, drive_commands_;
  Sample<nav_msgs::msg::Odometry> drive_odometry_;
  Sample<geometry_msgs::msg::TwistStamped> drive_linear_command_;
  Sample<telemetry_interfaces::msg::ArmControlStatus> arm_status_;
  Sample<telemetry_interfaces::msg::ArmMoveItStatus> arm_planner_;
  Sample<std_msgs::msg::Bool> estop_;
  std::map<std::int64_t, Sample<arm_interfaces::msg::MotorStat1>> motors_;
  std::map<std::int64_t, Sample<arm_interfaces::msg::MotorStat2>> motor_details_;
  std::map<std::uint32_t, Sample<dcr_arm_driver::msg::DirectDrive>> commands_;
  std::array<Sample<std::int32_t>, 4> temperatures_{};
  std::array<Sample<std::int32_t>, 4> currents_{};
  rclcpp::Publisher<telemetry_interfaces::msg::RecoverySnapshot>::SharedPtr publisher_;
  std::vector<rclcpp::SubscriptionBase::SharedPtr> subscriptions_;
  rclcpp::TimerBase::SharedPtr timer_;
};
}
