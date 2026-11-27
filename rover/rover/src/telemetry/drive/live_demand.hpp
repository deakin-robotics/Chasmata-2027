#pragma once
#include <array>
#include <chrono>
#include <map>
#include <mutex>
#include <string>
#include <vector>
#include <rclcpp/rclcpp.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <std_msgs/msg/int32_multi_array.hpp>
#include <std_msgs/msg/bool.hpp>
#include <geometry_msgs/msg/twist_stamped.hpp>
#include <nav_msgs/msg/odometry.hpp>
#include <telemetry_interfaces/msg/drive_telemetry_demand.hpp>

namespace rover::telemetry::drive {
class LiveDemand {
  using Clock = std::chrono::steady_clock;
public:
  explicit LiveDemand(rclcpp::Node & node) : node_(node) {
    state_ = node.create_publisher<std_msgs::msg::Bool>("/drivetrain/telemetry_live", 10);
    demand_ = node.create_subscription<telemetry_interfaces::msg::DriveTelemetryDemand>("/telemetry/drive/demand", 100,
      [this](const telemetry_interfaces::msg::DriveTelemetryDemand & msg) {
        if (msg.client_id.empty() || msg.client_id.size() > 128) return;
        std::lock_guard<std::mutex> lock(mutex_);
        if (msg.active) { if (clients_.size() < 128 || clients_.count(msg.client_id)) clients_[msg.client_id] = Clock::now(); }
        else clients_.erase(msg.client_id);
        publishState();
      });
    relay<sensor_msgs::msg::JointState>("joint_states", 0);
    relay<sensor_msgs::msg::JointState>("commands", 1);
    relay<nav_msgs::msg::Odometry>("odometry", 2);
    relay<geometry_msgs::msg::TwistStamped>("linear_command", 3);
    relayRaw("temperature_raw", 4);
    relayRaw("current_raw", 8);
    timer_ = node.create_wall_timer(std::chrono::milliseconds(250), [this] {
      std::lock_guard<std::mutex> lock(mutex_); publishState();
    });
  }
private:
  bool active() {
    const auto now = Clock::now();
    for (auto it = clients_.begin(); it != clients_.end();) {
      if (now - it->second >= std::chrono::seconds(3)) it = clients_.erase(it); else ++it;
    }
    return !clients_.empty();
  }
  void publishState() { std_msgs::msg::Bool msg; msg.data = active(); state_->publish(msg); }
  bool allowed(std::size_t slot) {
    std::lock_guard<std::mutex> lock(mutex_);
    const auto now = Clock::now();
    if (!active() || (last_[slot] != Clock::time_point{} && now - last_[slot] < std::chrono::milliseconds(100))) return false;
    last_[slot] = now; return true;
  }
  template<typename T> void relay(const std::string & name, std::size_t slot) {
    auto pub = node_.create_publisher<T>("/telemetry/drive/live/" + name, 10);
    publishers_.push_back(pub);
    subscriptions_.push_back(node_.create_subscription<T>("/telemetry/drive/" + name, 10,
      [this, pub, slot](const T & msg) { if (allowed(slot)) pub->publish(msg); }));
  }
  void relayRaw(const std::string & name, std::size_t offset) {
    using T = std_msgs::msg::Int32MultiArray;
    auto pub = node_.create_publisher<T>("/telemetry/drive/live/" + name, 10);
    publishers_.push_back(pub);
    subscriptions_.push_back(node_.create_subscription<T>("/telemetry/drive/" + name, 10,
      [this, pub, offset](const T & msg) {
        if (msg.data.size() != 2 || msg.data[0] < 0 || msg.data[0] > 3) return;
        if (allowed(offset + static_cast<std::size_t>(msg.data[0]))) pub->publish(msg);
      }));
  }
  rclcpp::Node & node_; std::mutex mutex_; std::map<std::string, Clock::time_point> clients_;
  std::array<Clock::time_point, 12> last_{};
  rclcpp::Publisher<std_msgs::msg::Bool>::SharedPtr state_;
  rclcpp::Subscription<telemetry_interfaces::msg::DriveTelemetryDemand>::SharedPtr demand_;
  std::vector<rclcpp::PublisherBase::SharedPtr> publishers_;
  std::vector<rclcpp::SubscriptionBase::SharedPtr> subscriptions_;
  rclcpp::TimerBase::SharedPtr timer_;
};
}
