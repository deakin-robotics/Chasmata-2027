#include "ecam_alerts/aggregator.hpp"

#include <algorithm>
#include <chrono>
#include <cctype>
#include <functional>
#include <stdexcept>

namespace ecam_alerts
{
namespace
{
std::string normalize_role(std::string role)
{
  role.erase(role.begin(), std::find_if_not(role.begin(), role.end(), [](unsigned char character) {
    return std::isspace(character) != 0;
  }));
  role.erase(std::find_if_not(role.rbegin(), role.rend(), [](unsigned char character) {
    return std::isspace(character) != 0;
  }).base(), role.end());
  std::transform(role.begin(), role.end(), role.begin(), [](unsigned char character) {
    return static_cast<char>(std::tolower(character));
  });
  return role;
}
}  // namespace

rclcpp::QoS combined_qos()
{
  return rclcpp::QoS(rclcpp::KeepLast(1)).reliable().transient_local();
}

EcamAlertAggregator::EcamAlertAggregator(const std::string & role_override,
  double timeout_override, const std::string & node_name)
: Node(node_name), started_at_(get_clock()->now())
{
  declare_parameter<std::string>("role", "rover");
  declare_parameter<double>("rover_timeout_seconds", kRoverTimeoutSeconds);
  role_ = normalize_role(role_override.empty() ? get_parameter("role").as_string() : role_override);
  if (role_ != "rover" && role_ != "basestation") {
    throw std::invalid_argument("role must be either 'rover' or 'basestation'");
  }
  timeout_seconds_ = std::max(timeout_override > 0.0 ? timeout_override :
    get_parameter("rover_timeout_seconds").as_double(), 0.1);
  taking_over_ = role_ == "rover";

  source_publisher_ = create_publisher<telemetry_interfaces::msg::EcamAlertSourceSnapshot>(
    kSourceTopic, snapshot_qos());
  combined_publisher_ = create_publisher<telemetry_interfaces::msg::EcamAlerts>(
    kCombinedTopic, combined_qos());
  source_subscription_ = create_subscription<telemetry_interfaces::msg::EcamAlertSourceSnapshot>(
    kSourceTopic, snapshot_qos(),
    std::bind(&EcamAlertAggregator::on_source_snapshot, this, std::placeholders::_1));
  combined_subscription_ = create_subscription<telemetry_interfaces::msg::EcamAlerts>(
    kCombinedTopic, combined_qos(),
    std::bind(&EcamAlertAggregator::on_combined_snapshot, this, std::placeholders::_1));

  if (role_ == "basestation") {
    base_station_alerts_ = std::make_unique<EcamAlertSource>(*this, "basestation");
    heartbeat_subscription_ = create_subscription<std_msgs::msg::Empty>(
      kRoverHeartbeatTopic, rclcpp::QoS(rclcpp::KeepLast(1)).reliable(),
      std::bind(&EcamAlertAggregator::on_rover_heartbeat, this, std::placeholders::_1));
    liveness_timer_ = create_wall_timer(std::chrono::milliseconds(100),
      std::bind(&EcamAlertAggregator::check_rover_liveness, this));
  }
  RCLCPP_INFO(get_logger(), "ECAM aggregator started as %s", role_.c_str());
}

void EcamAlertAggregator::on_source_snapshot(
  const telemetry_interfaces::msg::EcamAlertSourceSnapshot::SharedPtr message)
{
  if (!is_valid_source(message->source)) {
    RCLCPP_WARN(get_logger(), "Ignoring unknown ECAM source: %s", message->source.c_str());
    return;
  }
  const bool changed = source_state_.update(message->source, message->timestamp, message->active_codes);
  if (role_ == "rover") {
    publish_combined();
  } else if (taking_over_ && changed) {
    if (awaiting_rover_reflection_ && message->source != "rover") {
      queue_source_replay(message->source);
    }
    publish_combined();
  }
}

void EcamAlertAggregator::on_combined_snapshot(const telemetry_interfaces::msg::EcamAlerts::SharedPtr message)
{
  if (role_ != "basestation" || message->authority != "rover") {
    return;
  }
  const auto rover_state = store_from_combined(*message);
  if (awaiting_rover_reflection_ && rover_state.reflects(source_state_)) {
    awaiting_rover_reflection_ = false;
    taking_over_ = false;
    source_replay_queue_.clear();
    RCLCPP_INFO(get_logger(), "Rover combined snapshot reflects BaseStation source state");
  }
  bool changed = false;
  for (const auto & snapshot : message->sources) {
    if (is_valid_source(snapshot.source)) {
      changed = source_state_.update(snapshot.source, snapshot.timestamp, snapshot.active_codes) || changed;
    }
  }
  if (taking_over_ && changed) {
    publish_combined();
  }
}

void EcamAlertAggregator::on_rover_heartbeat(const std_msgs::msg::Empty::SharedPtr)
{
  last_rover_heartbeat_ = get_clock()->now();
}

void EcamAlertAggregator::check_rover_liveness()
{
  if (awaiting_rover_reflection_) {
    publish_next_replay_snapshot();
  }
  const auto now = get_clock()->now();
  if (!last_rover_heartbeat_) {
    if ((now - started_at_).seconds() >= timeout_seconds_ && !taking_over_) {
      taking_over_ = true;
      source_replay_queue_.clear();
      raise_rover_heartbeat_lost();
      publish_combined();
      RCLCPP_WARN(get_logger(), "Rover heartbeat not received; BaseStation is combining ECAM state");
    }
    return;
  }
  const bool rover_alive = (now - *last_rover_heartbeat_).seconds() < timeout_seconds_;
  if (rover_alive == rover_alive_) {
    return;
  }
  rover_alive_ = rover_alive;
  if (rover_alive_) {
    if (taking_over_) {
      awaiting_rover_reflection_ = true;
      queue_all_non_rover_sources();
      if (base_station_alerts_ && std::binary_search(base_station_alerts_->active_codes().begin(),
        base_station_alerts_->active_codes().end(), std::string(kRoverHeartbeatLost)))
      {
        base_station_alerts_->clear(kRoverHeartbeatLost);
        sync_base_station_source_snapshot();
        queue_source_replay("basestation");
      }
      publish_combined();
      RCLCPP_INFO(get_logger(), "Rover heartbeat returned; synchronizing source snapshots");
    }
  } else {
    awaiting_rover_reflection_ = false;
    taking_over_ = true;
    source_replay_queue_.clear();
    raise_rover_heartbeat_lost();
    publish_combined();
    RCLCPP_WARN(get_logger(), "Rover heartbeat lost; BaseStation is combining ECAM state");
  }
}

void EcamAlertAggregator::raise_rover_heartbeat_lost()
{
  if (base_station_alerts_) {
    base_station_alerts_->raise_alert(kRoverHeartbeatLost);
    sync_base_station_source_snapshot();
  }
}

void EcamAlertAggregator::sync_base_station_source_snapshot()
{
  if (base_station_alerts_) {
    source_state_.update("basestation", base_station_alerts_->last_snapshot_timestamp(),
      base_station_alerts_->active_codes());
  }
}

void EcamAlertAggregator::queue_all_non_rover_sources()
{
  source_replay_queue_.clear();
  for (const auto & snapshot : source_state_.snapshots()) {
    if (snapshot.source != "rover") {
      source_replay_queue_.push_back(snapshot.source);
    }
  }
}

void EcamAlertAggregator::queue_source_replay(const std::string & source)
{
  if (source != "rover" && std::find(source_replay_queue_.begin(), source_replay_queue_.end(), source) ==
    source_replay_queue_.end())
  {
    source_replay_queue_.push_back(source);
  }
}

void EcamAlertAggregator::publish_next_replay_snapshot()
{
  if (source_replay_queue_.empty()) {
    queue_all_non_rover_sources();
  }
  if (source_replay_queue_.empty()) {
    return;
  }
  const auto source = source_replay_queue_.front();
  source_replay_queue_.erase(source_replay_queue_.begin());
  const auto * snapshot = source_state_.get(source);
  if (snapshot == nullptr || source == "rover") {
    return;
  }
  telemetry_interfaces::msg::EcamAlertSourceSnapshot message;
  message.source = snapshot->source;
  message.timestamp = snapshot->timestamp;
  message.active_codes = snapshot->active_codes;
  source_publisher_->publish(message);
}

void EcamAlertAggregator::publish_combined()
{
  telemetry_interfaces::msg::EcamAlerts message;
  message.timestamp = get_clock()->now();
  message.authority = role_;
  for (const auto & source_snapshot : source_state_.snapshots()) {
    telemetry_interfaces::msg::EcamAlertSourceSnapshot snapshot;
    snapshot.source = source_snapshot.source;
    snapshot.timestamp = source_snapshot.timestamp;
    snapshot.active_codes = source_snapshot.active_codes;
    message.sources.push_back(std::move(snapshot));
  }
  combined_publisher_->publish(message);
}

SourceSnapshotStore EcamAlertAggregator::store_from_combined(
  const telemetry_interfaces::msg::EcamAlerts & message) const
{
  SourceSnapshotStore store;
  for (const auto & snapshot : message.sources) {
    if (is_valid_source(snapshot.source)) {
      store.update(snapshot.source, snapshot.timestamp, snapshot.active_codes);
    }
  }
  return store;
}
}  // namespace ecam_alerts
