#pragma once
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <functional>
#include <string>
#include <utility>
#include <rclcpp/rclcpp.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <std_msgs/msg/bool.hpp>
#include <std_msgs/msg/float64_multi_array.hpp>
#include <std_msgs/msg/int32_multi_array.hpp>
#include <geometry_msgs/msg/twist_stamped.hpp>
#include <nav_msgs/msg/odometry.hpp>

namespace rover {
class MockDrivetrain final
{
public:
  MockDrivetrain(rclcpp::Node & node, std::function<bool()> enabled) : node_(node), enabled_(std::move(enabled))
  {
    publisher_ = node.create_publisher<sensor_msgs::msg::JointState>("/mock/drivetrain/joint_states", 10);
    commands_ = node.create_publisher<sensor_msgs::msg::JointState>("/mock/drivetrain/commands", 10);
    temperatures_ = node.create_publisher<std_msgs::msg::Int32MultiArray>("/mock/drivetrain/temperature_raw", 10);
    currents_ = node.create_publisher<std_msgs::msg::Int32MultiArray>("/mock/drivetrain/current_raw", 10);
    odometry_ = node.create_publisher<nav_msgs::msg::Odometry>("/mock/drivetrain/odometry", 10);
    linear_commands_ = node.create_publisher<geometry_msgs::msg::TwistStamped>("/mock/drivetrain/linear_command", 10);
    faults_ = node.create_publisher<std_msgs::msg::Int32MultiArray>("/mock/drivetrain/fault_raw", rclcpp::QoS(4).reliable().transient_local());
    fault_injection_ = node.create_subscription<std_msgs::msg::Int32MultiArray>("/mock/drive/fault", 10,
      [this](const std_msgs::msg::Int32MultiArray & message) {
        if (message.data.size() != 2 || message.data[0] < 0 || message.data[0] >= 4 || message.data[1] < 0 || message.data[1] > 65535) return;
        simulated_faults_[static_cast<std::size_t>(message.data[0])] = message.data[1];
      });
    subscriber_ = node.create_subscription<std_msgs::msg::Float64MultiArray>("/mock/drivetrain/wheel_commands", 10,
      [this](const std_msgs::msg::Float64MultiArray & message) {
        if (!enabled_() || message.data.size() != 4 ||
            !std::all_of(message.data.begin(), message.data.end(), [](double v) { return std::isfinite(v); })) return;
        std::copy(message.data.begin(), message.data.end(), targets_.begin());
        last_input_ = std::chrono::steady_clock::now();
      });
    timer_ = node.create_wall_timer(std::chrono::milliseconds(100), [this] {
      if (!enabled_() || std::chrono::steady_clock::now() - last_input_ > std::chrono::milliseconds(300)) targets_.fill(0.0);
      const auto now = std::chrono::steady_clock::now();
      const double dt = last_sample_ == std::chrono::steady_clock::time_point{} ? 0.1 :
        std::clamp(std::chrono::duration<double>(now - last_sample_).count(), 0.001, 0.25);
      last_sample_ = now;
      const auto targets = targets_;
      for (std::size_t wheel = 0; wheel < targets.size(); ++wheel) {
        // First-order motor response: torque accelerates an inertial wheel against drag.
        constexpr double inertia = 0.35, drag = 0.25, response_time = 0.45;
        const double acceleration = (targets[wheel] - wheel_speed_[wheel]) / response_time;
        wheel_speed_[wheel] += acceleration * dt;
        if (targets[wheel] == 0.0 && std::abs(wheel_speed_[wheel]) < 0.01) wheel_speed_[wheel] = 0.0;
        const double torque = inertia * acceleration + drag * wheel_speed_[wheel];
        // Raw counts are a synthetic current derived from motor torque, not joystick input.
        mock_current_[wheel] = enabled_() ? std::abs(torque) * 80.0 : 0.0;
      }
      sensor_msgs::msg::JointState message;
      message.header.stamp = node_.now();
      message.name = {"front_left_wheel_joint", "rear_left_wheel_joint", "front_right_wheel_joint", "rear_right_wheel_joint"};
      message.velocity.assign(wheel_speed_.begin(), wheel_speed_.end());
      publisher_->publish(message);
      message.velocity.assign(targets.begin(), targets.end());
      commands_->publish(message);
      const double linear_speed = (wheel_speed_[0] + wheel_speed_[2]) * 0.05;
      position_ += linear_speed * dt;
      nav_msgs::msg::Odometry odom;
      odom.header.stamp = message.header.stamp;
      odom.pose.pose.position.x = position_;
      odom.pose.pose.orientation.w = 1.0;
      odom.twist.twist.linear.x = linear_speed;
      odometry_->publish(odom);
      geometry_msgs::msg::TwistStamped linear;
      linear.header.stamp = message.header.stamp;
      linear.twist.linear.x = (targets[0] + targets[1] + targets[2] + targets[3]) * 0.025;
      linear_commands_->publish(linear);
    });
    live_subscriber_ = node.create_subscription<std_msgs::msg::Bool>("/drivetrain/telemetry_live", 10,
      [this](const std_msgs::msg::Bool & message) { live_ = message.data; });
    temperature_timer_ = node.create_wall_timer(std::chrono::milliseconds(100), [this] {
      const auto now = std::chrono::steady_clock::now();
      if (last_optional_ != std::chrono::steady_clock::time_point{} &&
          now - last_optional_ < (live_ ? std::chrono::milliseconds(100) : std::chrono::milliseconds(1000))) return;
      last_optional_ = now;
      for (std::int32_t wheel = 0; wheel < 4; ++wheel) {
        std_msgs::msg::Int32MultiArray sample;
        sample.data = {wheel, 30 + wheel};
        temperatures_->publish(sample);
        sample.data = {wheel, static_cast<std::int32_t>(std::lround(mock_current_[static_cast<std::size_t>(wheel)]))};
        currents_->publish(sample);
        sample.data = {wheel, simulated_faults_[static_cast<std::size_t>(wheel)]};
        faults_->publish(sample);
      }
    });
  }
private:
  rclcpp::Node & node_;
  std::function<bool()> enabled_;
  std::array<double, 4> targets_{};
  std::array<std::int32_t, 4> simulated_faults_{};
  std::array<double, 4> mock_current_{}, wheel_speed_{};
  double position_{0.0};
  std::chrono::steady_clock::time_point last_input_{};
  std::chrono::steady_clock::time_point last_sample_{};
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr publisher_;
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr commands_;
  rclcpp::Publisher<std_msgs::msg::Int32MultiArray>::SharedPtr temperatures_;
  rclcpp::Publisher<std_msgs::msg::Int32MultiArray>::SharedPtr currents_;
  rclcpp::Publisher<nav_msgs::msg::Odometry>::SharedPtr odometry_;
  rclcpp::Publisher<geometry_msgs::msg::TwistStamped>::SharedPtr linear_commands_;
  rclcpp::Publisher<std_msgs::msg::Int32MultiArray>::SharedPtr faults_;
  rclcpp::Subscription<std_msgs::msg::Float64MultiArray>::SharedPtr subscriber_;
  rclcpp::Subscription<std_msgs::msg::Int32MultiArray>::SharedPtr fault_injection_;
  rclcpp::TimerBase::SharedPtr timer_;
  rclcpp::TimerBase::SharedPtr temperature_timer_;
  rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr live_subscriber_;
  std::chrono::steady_clock::time_point last_optional_{};
  bool live_{false};
};
}
