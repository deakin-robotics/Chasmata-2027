#include "ecam_alerts/source.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <stdexcept>
#include <utility>

namespace ecam_alerts
{
namespace
{
constexpr std::array<const char *, 5> kSourceNames{
  "driver", "ecam", "arm", "basestation", "rover"};

std::string trim(const std::string & value)
{
  const auto first = std::find_if_not(value.begin(), value.end(), [](unsigned char character) {
    return std::isspace(character) != 0;
  });
  const auto last = std::find_if_not(value.rbegin(), value.rend(), [](unsigned char character) {
    return std::isspace(character) != 0;
  }).base();
  return first < last ? std::string(first, last) : std::string{};
}
}  // namespace

bool is_valid_source(const std::string & source)
{
  return std::any_of(kSourceNames.begin(), kSourceNames.end(), [&source](const char * candidate) {
    return source == candidate;
  });
}

rclcpp::QoS snapshot_qos()
{
  return rclcpp::QoS(rclcpp::KeepLast(1)).reliable().transient_local();
}

EcamAlertSource::EcamAlertSource(rclcpp::Node & node, std::string source)
: node_(node), source_(std::move(source))
{
  if (!is_valid_source(source_)) {
    throw std::invalid_argument("Unknown ECAM reporting source: " + source_);
  }
  publisher_ = node_.create_publisher<telemetry_interfaces::msg::EcamAlertSourceSnapshot>(
    kSourceTopic, snapshot_qos());
  publish_snapshot();
}

const std::string & EcamAlertSource::source() const { return source_; }

const std::vector<std::string> & EcamAlertSource::active_codes() const { return active_codes_; }

const builtin_interfaces::msg::Time & EcamAlertSource::last_snapshot_timestamp() const
{
  return last_snapshot_timestamp_;
}

void EcamAlertSource::raise_alert(const std::string & code)
{
  const auto normalized = trim(code);
  if (normalized.empty() || std::binary_search(active_codes_.begin(), active_codes_.end(), normalized)) {
    return;
  }
  active_codes_.insert(std::lower_bound(active_codes_.begin(), active_codes_.end(), normalized), normalized);
  publish_snapshot();
}

void EcamAlertSource::clear(const std::string & code)
{
  const auto normalized = trim(code);
  const auto found = std::lower_bound(active_codes_.begin(), active_codes_.end(), normalized);
  if (found == active_codes_.end() || *found != normalized) {
    return;
  }
  active_codes_.erase(found);
  publish_snapshot();
}

void EcamAlertSource::clear_all()
{
  if (!active_codes_.empty()) {
    active_codes_.clear();
    publish_snapshot();
  }
}

void EcamAlertSource::publish_snapshot()
{
  telemetry_interfaces::msg::EcamAlertSourceSnapshot message;
  message.source = source_;
  message.timestamp = node_.get_clock()->now().to_msg();
  message.active_codes = active_codes_;
  last_snapshot_timestamp_ = message.timestamp;
  publisher_->publish(message);
}
}  // namespace ecam_alerts
