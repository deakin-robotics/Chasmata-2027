#pragma once

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/empty.hpp>
#include <telemetry_interfaces/msg/ecam_alert_source_snapshot.hpp>
#include <telemetry_interfaces/msg/ecam_alerts.hpp>

#include "ecam_alerts/source.hpp"
#include "ecam_alerts/state.hpp"

namespace ecam_alerts
{
inline constexpr char kCombinedTopic[] = "/ecam/alerts";
inline constexpr char kRoverHeartbeatTopic[] = "/rover/heartbeat";
inline constexpr char kRoverHeartbeatLost[] = "ROVER_HEARTBEAT_LOST";
inline constexpr double kRoverTimeoutSeconds = 3.0;

rclcpp::QoS combined_qos();

class EcamAlertAggregator : public rclcpp::Node
{
public:
  explicit EcamAlertAggregator(const std::string & role_override = "", double timeout_override = 0.0,
    const std::string & node_name = "ecam_alert_aggregator");

private:
  void on_source_snapshot(const telemetry_interfaces::msg::EcamAlertSourceSnapshot::SharedPtr message);
  void on_combined_snapshot(const telemetry_interfaces::msg::EcamAlerts::SharedPtr message);
  void on_rover_heartbeat(const std_msgs::msg::Empty::SharedPtr message);
  void check_rover_liveness();
  void raise_rover_heartbeat_lost();
  void sync_base_station_source_snapshot();
  void queue_all_non_rover_sources();
  void queue_source_replay(const std::string & source);
  void publish_next_replay_snapshot();
  void publish_combined();
  SourceSnapshotStore store_from_combined(const telemetry_interfaces::msg::EcamAlerts & message) const;

  std::string role_;
  double timeout_seconds_;
  rclcpp::Time started_at_;
  std::optional<rclcpp::Time> last_rover_heartbeat_;
  bool rover_alive_{false};
  bool taking_over_{false};
  bool awaiting_rover_reflection_{false};
  SourceSnapshotStore source_state_;
  std::vector<std::string> source_replay_queue_;
  std::unique_ptr<EcamAlertSource> base_station_alerts_;
  rclcpp::Publisher<telemetry_interfaces::msg::EcamAlertSourceSnapshot>::SharedPtr source_publisher_;
  rclcpp::Publisher<telemetry_interfaces::msg::EcamAlerts>::SharedPtr combined_publisher_;
  rclcpp::Subscription<telemetry_interfaces::msg::EcamAlertSourceSnapshot>::SharedPtr source_subscription_;
  rclcpp::Subscription<telemetry_interfaces::msg::EcamAlerts>::SharedPtr combined_subscription_;
  rclcpp::Subscription<std_msgs::msg::Empty>::SharedPtr heartbeat_subscription_;
  rclcpp::TimerBase::SharedPtr liveness_timer_;
};
}  // namespace ecam_alerts
