#pragma once

#include "../telemetry_backend.hpp"
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <functional>
#include <utility>
#include <vector>
#include <rclcpp/rclcpp.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <sensor_msgs/msg/joy.hpp>
#include <geometry_msgs/msg/twist_stamped.hpp>
#include <nav_msgs/msg/odometry.hpp>
#include <std_msgs/msg/float64_multi_array.hpp>
#include <std_msgs/msg/int32_multi_array.hpp>
#include <std_msgs/msg/bool.hpp>

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
    currents_ = node.create_publisher<std_msgs::msg::Int32MultiArray>("/telemetry/drive/current_raw", 10);
    odometry_ = node.create_publisher<nav_msgs::msg::Odometry>("/telemetry/drive/odometry", 10);
    linear_commands_ = node.create_publisher<geometry_msgs::msg::TwistStamped>("/telemetry/drive/linear_command", 10);
    faults_ = node.create_publisher<std_msgs::msg::Int32MultiArray>("/telemetry/drive/fault_raw", rclcpp::QoS(4).reliable().transient_local());
    subscriber_ = node.create_subscription<sensor_msgs::msg::JointState>("/drivetrain/validated_joint_states", 10,
      [this](const sensor_msgs::msg::JointState & message) {
        if (message.name.empty() || message.name.size() != message.velocity.size() ||
            !std::all_of(message.velocity.begin(), message.velocity.end(), [](double value) { return std::isfinite(value); })) return;
        last_feedback_ = std::chrono::steady_clock::now();
        publisher_->publish(message);
      });
    temperature_subscriber_ = node.create_subscription<std_msgs::msg::Int32MultiArray>("/drivetrain/temperature_raw", 10,
      [this](const std_msgs::msg::Int32MultiArray & message) { temperatures_->publish(message); });
    current_subscriber_ = node.create_subscription<std_msgs::msg::Int32MultiArray>("/drivetrain/current_raw", 10,
      [this](const std_msgs::msg::Int32MultiArray & message) { currents_->publish(message); });
    odometry_subscriber_ = node.create_subscription<nav_msgs::msg::Odometry>("/drivetrain/diff_drive_controller/odom", 10,
      [this](const nav_msgs::msg::Odometry & message) {
        if (last_feedback_ == std::chrono::steady_clock::time_point{} ||
            std::chrono::steady_clock::now() - last_feedback_ > std::chrono::milliseconds(1500)) return;
        odometry_->publish(message);
      });
    fault_subscriber_ = node.create_subscription<std_msgs::msg::Int32MultiArray>("/drivetrain/fault_raw", rclcpp::QoS(4).reliable().transient_local(),
      [this](const std_msgs::msg::Int32MultiArray & message) { faults_->publish(message); });
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
    geometry_msgs::msg::TwistStamped linear;
    linear.header.stamp = message.header.stamp;
    linear.twist.linear.x = (speeds[0] + speeds[1] + speeds[2] + speeds[3]) * radius_ / 4.0;
    linear_commands_->publish(linear);
  }
  rclcpp::Node & node_;
  double radius_, separation_;
  std::chrono::steady_clock::time_point last_feedback_{};
  std::function<std::string()> mode_;
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr publisher_;
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr commands_;
  rclcpp::Publisher<std_msgs::msg::Int32MultiArray>::SharedPtr temperatures_;
  rclcpp::Publisher<std_msgs::msg::Int32MultiArray>::SharedPtr currents_;
  rclcpp::Publisher<nav_msgs::msg::Odometry>::SharedPtr odometry_;
  rclcpp::Publisher<geometry_msgs::msg::TwistStamped>::SharedPtr linear_commands_;
  rclcpp::Publisher<std_msgs::msg::Int32MultiArray>::SharedPtr faults_;
  rclcpp::Subscription<sensor_msgs::msg::JointState>::SharedPtr subscriber_;
  rclcpp::Subscription<std_msgs::msg::Int32MultiArray>::SharedPtr temperature_subscriber_;
  rclcpp::Subscription<std_msgs::msg::Int32MultiArray>::SharedPtr current_subscriber_;
  rclcpp::Subscription<nav_msgs::msg::Odometry>::SharedPtr odometry_subscriber_;
  rclcpp::Subscription<std_msgs::msg::Int32MultiArray>::SharedPtr fault_subscriber_;
  rclcpp::Subscription<std_msgs::msg::Float64MultiArray>::SharedPtr manual_subscriber_;
  rclcpp::Subscription<geometry_msgs::msg::TwistStamped>::SharedPtr velocity_subscriber_;
};

class MockBackend final : public Backend {
public:
  explicit MockBackend(rclcpp::Node & node) {
    relay<sensor_msgs::msg::JointState>(node, "joint_states");
    relay<sensor_msgs::msg::JointState>(node, "commands");
    relay<std_msgs::msg::Int32MultiArray>(node, "temperature_raw");
    relay<std_msgs::msg::Int32MultiArray>(node, "current_raw");
    relay<nav_msgs::msg::Odometry>(node, "odometry");
    relay<geometry_msgs::msg::TwistStamped>(node, "linear_command");
    relay<std_msgs::msg::Int32MultiArray>(node, "fault_raw", rclcpp::QoS(4).reliable().transient_local());
  }
private:
  template<typename T> void relay(rclcpp::Node & node, const std::string & name, const rclcpp::QoS & qos = rclcpp::QoS(10)) {
    auto pub = node.create_publisher<T>("/telemetry/drive/" + name, qos);
    publishers_.push_back(pub);
    subscriptions_.push_back(node.create_subscription<T>("/mock/drivetrain/" + name, qos,
      [pub](const T & value) { pub->publish(value); }));
  }
  std::vector<rclcpp::PublisherBase::SharedPtr> publishers_;
  std::vector<rclcpp::SubscriptionBase::SharedPtr> subscriptions_;
};
}
