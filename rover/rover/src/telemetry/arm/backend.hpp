#pragma once

#include "../telemetry_backend.hpp"
#include <chrono>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <functional>
#include <string>
#include <utility>
#include <arm_interfaces/msg/motor_stat1.hpp>
#include <action_msgs/msg/goal_status_array.hpp>
#include <dcr_arm_driver/msg/direct_drive.hpp>
#include <control_msgs/action/follow_joint_trajectory.hpp>
#include <rclcpp/rclcpp.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <sensor_msgs/msg/joy.hpp>
#include <telemetry_interfaces/msg/arm_control_status.hpp>

namespace rover::telemetry::arm
{
// Both control backends expose the same joint-state contract.
class JointStateBackend : public Backend
{
public:
  explicit JointStateBackend(rclcpp::Node & node)
  {
    publisher_ = node.create_publisher<sensor_msgs::msg::JointState>("/telemetry/arm/joint_states", 10);
    subscriber_ = node.create_subscription<sensor_msgs::msg::JointState>("/arm/joint_states", 10,
      [this](const sensor_msgs::msg::JointState & message) { publisher_->publish(message); });
    trajectory_publisher_ = node.create_publisher<sensor_msgs::msg::JointState>("/telemetry/arm/trajectory_commands", 10);
    trajectory_subscriber_ = node.create_subscription<control_msgs::action::FollowJointTrajectory::Impl::FeedbackMessage>(
      "/arm_controller/follow_joint_trajectory/_action/feedback", 10,
      [this](const control_msgs::action::FollowJointTrajectory::Impl::FeedbackMessage & message) {
        const auto & feedback = message.feedback;
        if (feedback.joint_names.empty() || feedback.desired.positions.size() != feedback.joint_names.size() ||
            !std::all_of(feedback.desired.positions.begin(), feedback.desired.positions.end(),
              [](double value) { return std::isfinite(value); })) return;
        sensor_msgs::msg::JointState command;
        command.header = feedback.header;
        command.name = feedback.joint_names;
        command.position = feedback.desired.positions;
        if (feedback.desired.velocities.size() == feedback.joint_names.size()) command.velocity = feedback.desired.velocities;
        trajectory_publisher_->publish(command);
      });
    trajectory_status_subscriber_ = node.create_subscription<action_msgs::msg::GoalStatusArray>(
      "/arm_controller/follow_joint_trajectory/_action/status", rclcpp::QoS(10).reliable().transient_local(),
      [this](const action_msgs::msg::GoalStatusArray & status) {
        const bool active = std::any_of(status.status_list.begin(), status.status_list.end(), [](const auto & goal) {
          return goal.status == action_msgs::msg::GoalStatus::STATUS_ACCEPTED ||
            goal.status == action_msgs::msg::GoalStatus::STATUS_EXECUTING;
        });
        if (!active) trajectory_publisher_->publish(sensor_msgs::msg::JointState{});
      });
  }
private:
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr publisher_;
  rclcpp::Subscription<sensor_msgs::msg::JointState>::SharedPtr subscriber_;
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr trajectory_publisher_;
  rclcpp::Subscription<control_msgs::action::FollowJointTrajectory::Impl::FeedbackMessage>::SharedPtr trajectory_subscriber_;
  rclcpp::Subscription<action_msgs::msg::GoalStatusArray>::SharedPtr trajectory_status_subscriber_;
};
class MockBackend final : public JointStateBackend
{
public:
  MockBackend(rclcpp::Node & node, std::function<std::string()> mode) : JointStateBackend(node), mode_(std::move(mode))
  {
    status_publisher_ = node.create_publisher<telemetry_interfaces::msg::ArmControlStatus>("/telemetry/arm/status", 10);
    motor_publisher_ = node.create_publisher<arm_interfaces::msg::MotorStat1>("/telemetry/arm/motor_status", 10);
    command_publisher_ = node.create_publisher<dcr_arm_driver::msg::DirectDrive>("/telemetry/arm/commands", 10);
    joy_subscriber_ = node.create_subscription<sensor_msgs::msg::Joy>("/arm/joy", 10,
      [this](const sensor_msgs::msg::Joy & joy) {
        if (mode_() != "MANUAL" || joy.axes.size() <= 9 || joy.buttons.size() <= 4) return;
        if (!std::isfinite(joy.axes[8]) || !std::isfinite(joy.axes[9]) ||
            joy.axes[8] < 0 || joy.axes[8] > 1 || joy.axes[9] < 0 || joy.axes[9] > 1 ||
            std::any_of(joy.buttons.begin(), joy.buttons.end(), [](int value) { return value != 0 && value != 1; })) return;
        const std::array<double, 6> axes{joy.axes[0], joy.axes[1], joy.buttons[4] ? 0.0 : joy.axes[4],
          joy.axes[6], joy.axes[7], joy.axes[9] - joy.axes[8]};
        for (std::size_t i = 0; i < axes.size(); ++i) {
          if (!std::isfinite(axes[i])) continue;
          dcr_arm_driver::msg::DirectDrive command;
          command.id = static_cast<std::uint32_t>(i + 1);
          command.mode = dcr_arm_driver::msg::DirectDrive::SPEED;
          command.value = axes[i] * 0.5 * 60.0 / (2.0 * 3.14159265358979323846);
          command_publisher_->publish(command);
        }
      });
    timer_ = node.create_wall_timer(std::chrono::seconds(1), [this] {
      telemetry_interfaces::msg::ArmControlStatus status;
      status.hardware_active = true;
      status.feedback_fresh = true;
      status.reason = "Simulated arm telemetry";
      status.joint_names = {"base_joint", "shoulder_joint", "elbow_joint", "yaw_joint", "pitch_joint", "roll_joint"};
      status.joint_can_ids = {1, 2, 3, 4, 5, 6};
      status_publisher_->publish(status);
      for (int id = 1; id <= 6; ++id) {
        arm_interfaces::msg::MotorStat1 motor;
        motor.id = id;
        motor.temp = 30 + id;
        motor.current = 0.0;
        motor_publisher_->publish(motor);
      }
    });
  }
private:
  std::function<std::string()> mode_;
  rclcpp::Publisher<telemetry_interfaces::msg::ArmControlStatus>::SharedPtr status_publisher_;
  rclcpp::Publisher<arm_interfaces::msg::MotorStat1>::SharedPtr motor_publisher_;
  rclcpp::Publisher<dcr_arm_driver::msg::DirectDrive>::SharedPtr command_publisher_;
  rclcpp::Subscription<sensor_msgs::msg::Joy>::SharedPtr joy_subscriber_;
  rclcpp::TimerBase::SharedPtr timer_;
};
class RealBackend final : public JointStateBackend
{
public:
  explicit RealBackend(rclcpp::Node & node) : JointStateBackend(node)
  {
    status_publisher_ = node.create_publisher<telemetry_interfaces::msg::ArmControlStatus>("/telemetry/arm/status", 10);
    motor_publisher_ = node.create_publisher<arm_interfaces::msg::MotorStat1>("/telemetry/arm/motor_status", 100);
    command_publisher_ = node.create_publisher<dcr_arm_driver::msg::DirectDrive>("/telemetry/arm/commands", 100);
    status_subscriber_ = node.create_subscription<telemetry_interfaces::msg::ArmControlStatus>("/arm/control/status", 10,
      [this](const telemetry_interfaces::msg::ArmControlStatus & message) { status_publisher_->publish(message); });
    motor_subscriber_ = node.create_subscription<arm_interfaces::msg::MotorStat1>("/motor_stat_1", 100,
      [this](const arm_interfaces::msg::MotorStat1 & message) { motor_publisher_->publish(message); });
    command_subscriber_ = node.create_subscription<dcr_arm_driver::msg::DirectDrive>("/arm/direct_drive", 100,
      [this](const dcr_arm_driver::msg::DirectDrive & message) { command_publisher_->publish(message); });
  }
private:
  rclcpp::Publisher<telemetry_interfaces::msg::ArmControlStatus>::SharedPtr status_publisher_;
  rclcpp::Subscription<telemetry_interfaces::msg::ArmControlStatus>::SharedPtr status_subscriber_;
  rclcpp::Publisher<arm_interfaces::msg::MotorStat1>::SharedPtr motor_publisher_;
  rclcpp::Subscription<arm_interfaces::msg::MotorStat1>::SharedPtr motor_subscriber_;
  rclcpp::Publisher<dcr_arm_driver::msg::DirectDrive>::SharedPtr command_publisher_;
  rclcpp::Subscription<dcr_arm_driver::msg::DirectDrive>::SharedPtr command_subscriber_;
};
}
