#pragma once

#include <algorithm>
#include <chrono>
#include <map>
#include <mutex>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>

#include <ecam_alerts/source.hpp>

namespace ecam_alerts
{
// Each reporter publishes only its own complete set; Rover merges all reporters.
inline constexpr char kReporterTopic[] = "/ecam/rover/reporters";

class Reporter
{
public:
  Reporter(rclcpp::Node & node, std::string reporter)
  : node_(node), reporter_(std::move(reporter))
  {
    if (reporter_.empty()) throw std::invalid_argument("ECAM reporter must have a name");
    publisher_ = node.create_publisher<telemetry_interfaces::msg::EcamAlertSourceSnapshot>(
      kReporterTopic, snapshot_qos());
    timer_ = node.create_wall_timer(std::chrono::milliseconds(50), [this] { publish(); });
    publish();
  }

  void raise(const std::string & code)
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!code.empty() && codes_.insert(code).second) dirty_ = true;
  }
  void clear(const std::string & code)
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (codes_.erase(code)) dirty_ = true;
  }

private:
  void publish()
  {
    telemetry_interfaces::msg::EcamAlertSourceSnapshot message;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      const auto now = std::chrono::steady_clock::now();
      if (!dirty_ && now - last_published_ < std::chrono::seconds(1)) return;
      message.active_codes.assign(codes_.begin(), codes_.end());
      dirty_ = false;
      last_published_ = now;
    }
    message.source = reporter_;
    message.timestamp = node_.get_clock()->now();
    publisher_->publish(message);
  }
  rclcpp::Node & node_;
  std::string reporter_;
  std::set<std::string> codes_;
  std::mutex mutex_;
  bool dirty_{true};
  std::chrono::steady_clock::time_point last_published_{};
  rclcpp::Publisher<telemetry_interfaces::msg::EcamAlertSourceSnapshot>::SharedPtr publisher_;
  rclcpp::TimerBase::SharedPtr timer_;
};

class RoverAlertOwner
{
public:
  explicit RoverAlertOwner(rclcpp::Node & node) : source_(node, "rover")
  {
    subscription_ = node.create_subscription<telemetry_interfaces::msg::EcamAlertSourceSnapshot>(
      kReporterTopic, rclcpp::QoS(100).reliable().transient_local(),
      [this](const telemetry_interfaces::msg::EcamAlertSourceSnapshot & message) {
        if (message.source.empty()) return;
        reporters_[message.source] = std::set<std::string>(message.active_codes.begin(), message.active_codes.end());
        std::set<std::string> combined;
        for (const auto & reporter : reporters_) {
          combined.insert(reporter.second.begin(), reporter.second.end());
        }
        source_.set_active_codes({combined.begin(), combined.end()});
      });
  }

private:
  EcamAlertSource source_;
  std::map<std::string, std::set<std::string>> reporters_;
  rclcpp::Subscription<telemetry_interfaces::msg::EcamAlertSourceSnapshot>::SharedPtr subscription_;
};
}  // namespace ecam_alerts
