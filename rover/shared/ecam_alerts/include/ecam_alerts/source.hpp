#pragma once

#include <string>
#include <vector>

#include <builtin_interfaces/msg/time.hpp>
#include <rclcpp/rclcpp.hpp>
#include <telemetry_interfaces/msg/ecam_alert_source_snapshot.hpp>

namespace ecam_alerts
{
inline constexpr char kSourceTopic[] = "/ecam/alerts/source";

bool is_valid_source(const std::string & source);
rclcpp::QoS snapshot_qos();

class EcamAlertSource
{
public:
  EcamAlertSource(rclcpp::Node & node, std::string source);
  const std::string & source() const;
  const std::vector<std::string> & active_codes() const;
  const builtin_interfaces::msg::Time & last_snapshot_timestamp() const;
  void raise_alert(const std::string & code);
  void clear(const std::string & code);
  void clear_all();
  void publish_snapshot();

private:
  rclcpp::Node & node_;
  std::string source_;
  std::vector<std::string> active_codes_;
  builtin_interfaces::msg::Time last_snapshot_timestamp_;
  rclcpp::Publisher<telemetry_interfaces::msg::EcamAlertSourceSnapshot>::SharedPtr publisher_;
};
}  // namespace ecam_alerts
