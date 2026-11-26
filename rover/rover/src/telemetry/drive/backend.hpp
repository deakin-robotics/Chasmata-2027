#pragma once

#include "../telemetry_backend.hpp"
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <functional>
#include <utility>
#include <rclcpp/rclcpp.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <sensor_msgs/msg/joy.hpp>
#include <geometry_msgs/msg/twist_stamped.hpp>
#include <std_msgs/msg/float64_multi_array.hpp>
#include <std_msgs/msg/int32_multi_array.hpp>

namespace rover::telemetry::drive
{
class RealBackend final : public Backend
{
public:
  explicit RealBackend(rclcpp::Node & node, double radius = 0.0, double separation = 0.0,
    std::function<std::string()> mode = [] { return std::string{}; })
  : node_(node), radius_(radius), separation_(separation), mode_(std::move(mode))
  {
    publisher_ = node.create_publisher<sensor_msgs::msg::JointState>("/telemetry/drive/joint_states", 10);
    commands_ = node.create_publisher<sensor_msgs::msg::JointState>("/telemetry/drive/commands", 10);
    temperatures_ = node.create_publisher<std_msgs::msg::Int32MultiArray>("/telemetry/drive/temperature_raw", 10);
    subscriber_ = node.create_subscription<sensor_msgs::msg::JointState>("/drivetrain/validated_joint_states", 10,
      [this](const sensor_msgs::msg::JointState & message) { publisher_->publish(message); });
    temperature_subscriber_ = node.create_subscription<std_msgs::msg::Int32MultiArray>("/drivetrain/temperature_raw", 10,
      [this](const std_msgs::msg::Int32MultiArray & message) { temperatures_->publish(message); });
    manual_subscriber_ = node.create_subscription<std_msgs::msg::Float64MultiArray>("/drivetrain/wheel_velocity_controller/commands", 10,
      [this](const std_msgs::msg::Float64MultiArray & message) {
        if (mode_() != "MANUAL" || message.data.size() != 4 ||
            !std::all_of(message.data.begin(), message.data.end(), [](double value) { return std::isfinite(value); })) return;
        publish_command(message.data);
      });
    velocity_subscriber_ = node.create_subscription<geometry_msgs::msg::TwistStamped>("/drivetrain/diff_drive_controller/cmd_vel", 10,
      [this](const geometry_msgs::msg::TwistStamped & message) {
        if (mode_() != "VELOCITY" || radius_ <= 0 || !std::isfinite(message.twist.linear.x) || !std::isfinite(message.twist.angular.z)) return;
        const double left = (message.twist.linear.x - message.twist.angular.z * separation_ / 2) / radius_;
        const double right = (message.twist.linear.x + message.twist.angular.z * separation_ / 2) / radius_;
        publish_command({left, left, right, right});
      });
  }
private:
  void publish_command(const std::vector<double> & speeds)
  {
    sensor_msgs::msg::JointState message;
    message.header.stamp = node_.now();
    message.name = {"front_left_wheel_joint", "rear_left_wheel_joint", "front_right_wheel_joint", "rear_right_wheel_joint"};
    message.velocity = speeds;
    commands_->publish(message);
  }
  rclcpp::Node & node_;
  double radius_, separation_;
  std::function<std::string()> mode_;
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr publisher_;
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr commands_;
  rclcpp::Publisher<std_msgs::msg::Int32MultiArray>::SharedPtr temperatures_;
  rclcpp::Subscription<sensor_msgs::msg::JointState>::SharedPtr subscriber_;
  rclcpp::Subscription<std_msgs::msg::Int32MultiArray>::SharedPtr temperature_subscriber_;
  rclcpp::Subscription<std_msgs::msg::Float64MultiArray>::SharedPtr manual_subscriber_;
  rclcpp::Subscription<geometry_msgs::msg::TwistStamped>::SharedPtr velocity_subscriber_;
};

class MockBackend final : public Backend
{
public:
  MockBackend(rclcpp::Node & node, std::function<bool()> enabled) : node_(node), enabled_(std::move(enabled))
  {
    publisher_ = node.create_publisher<sensor_msgs::msg::JointState>("/telemetry/drive/joint_states", 10);
    commands_ = node.create_publisher<sensor_msgs::msg::JointState>("/telemetry/drive/commands", 10);
    temperatures_ = node.create_publisher<std_msgs::msg::Int32MultiArray>("/telemetry/drive/temperature_raw", 10);
    subscriber_ = node.create_subscription<sensor_msgs::msg::Joy>("/drive/joy", 10,
      [this](const sensor_msgs::msg::Joy & message) {
        if (!enabled_()) return;
        if (message.axes.size() < 2 || !std::isfinite(message.axes[0]) || !std::isfinite(message.axes[1]) ||
            std::abs(message.axes[0]) > 1 || std::abs(message.axes[1]) > 1) return;
        left_ = std::clamp(-message.axes[1] + message.axes[0], -1.0f, 1.0f);
        right_ = std::clamp(-message.axes[1] - message.axes[0], -1.0f, 1.0f);
        last_input_ = std::chrono::steady_clock::now();
      });
    timer_ = node.create_wall_timer(std::chrono::milliseconds(100), [this] {
      if (!enabled_() || std::chrono::steady_clock::now() - last_input_ > std::chrono::milliseconds(300)) left_ = right_ = 0.0;
      sensor_msgs::msg::JointState message;
      message.header.stamp = node_.now();
      message.name = {"front_left_wheel_joint", "rear_left_wheel_joint", "front_right_wheel_joint", "rear_right_wheel_joint"};
      message.velocity = {left_, left_, right_, right_};
      publisher_->publish(message);
      commands_->publish(message);
    });
    temperature_timer_ = node.create_wall_timer(std::chrono::seconds(1), [this] {
      for (std::int32_t wheel = 0; wheel < 4; ++wheel) {
        std_msgs::msg::Int32MultiArray sample;
        sample.data = {wheel, 30 + wheel};
        temperatures_->publish(sample);
      }
    });
  }
private:
  rclcpp::Node & node_;
  std::function<bool()> enabled_;
  double left_{0.0}, right_{0.0};
  std::chrono::steady_clock::time_point last_input_{};
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr publisher_;
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr commands_;
  rclcpp::Publisher<std_msgs::msg::Int32MultiArray>::SharedPtr temperatures_;
  rclcpp::Subscription<sensor_msgs::msg::Joy>::SharedPtr subscriber_;
  rclcpp::TimerBase::SharedPtr timer_;
  rclcpp::TimerBase::SharedPtr temperature_timer_;
};
}
