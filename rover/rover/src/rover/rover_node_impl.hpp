#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cctype>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include <control_msgs/action/follow_joint_trajectory.hpp>
#include <rclcpp/rclcpp.hpp>
#include <rclcpp_action/rclcpp_action.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <sensor_msgs/msg/joy.hpp>
#include <std_msgs/msg/bool.hpp>
#include <std_msgs/msg/empty.hpp>
#include <std_msgs/msg/string.hpp>
#include <telemetry_interfaces/msg/arm_override_state.hpp>
#include <telemetry_interfaces/msg/fma_mode_state.hpp>
#include <telemetry_interfaces/msg/fma_state.hpp>

#include "rover/joint_simulator.hpp"
#include "rover/drive_backend.hpp"
#include "rover/arm_backend.hpp"
#include "rover/rover_node.hpp"

namespace rover
{
class RoverNode : public rclcpp::Node
{
public:
  explicit RoverNode(std::unique_ptr<DriveBackend> drive_backend, const rclcpp::NodeOptions & options = rclcpp::NodeOptions());
  ~RoverNode() override;

private:
  struct Pending { std::string value; std::chrono::steady_clock::time_point due; };

  void request_mode(const std::string & subsystem, const std::string & raw_mode);
  void request_override(const std::string & raw);
  void request_gimbal(const std::string & raw);
  std::chrono::steady_clock::time_point due_time() const;
  void on_drive_joy(const sensor_msgs::msg::Joy & message);
  void tick();
  void publish_fma();
  telemetry_interfaces::msg::FmaModeState mode_state(const std::string & subsystem, const std::string & confirmed) const;
  void publish_heartbeat();

  std::unique_ptr<DriveBackend> drive_backend_;
  std::unique_ptr<ArmBackend> arm_backend_;
  double ack_delay_{0.15};
  std::string drive_mode_, arm_mode_, law_{"NORMAL"}, override_state_{"INACTIVE"}, gimbal_priority_;
  bool rover_protection_{true}; uint64_t sequence_{0}; std::chrono::steady_clock::time_point last_fma_{std::chrono::steady_clock::now()};
  std::map<std::string, Pending> pending_modes_; std::map<std::string, std::string> rejected_modes_;
  std::map<std::string, std::chrono::steady_clock::time_point> rejection_clear_;
  std::optional<Pending> pending_override_, pending_gimbal_;
  const std::set<std::string> drive_modes_{"MANUAL", "VELOCITY", "MANAGED"};
  const std::set<std::string> arm_modes_{"MANUAL", "POSITION", "MANAGED", "STOWED"};
  rclcpp::Publisher<telemetry_interfaces::msg::FmaState>::SharedPtr fma_publisher_;
  rclcpp::Publisher<std_msgs::msg::Empty>::SharedPtr heartbeat_publisher_;
  std::vector<rclcpp::SubscriptionBase::SharedPtr> subscriptions_;
  rclcpp::TimerBase::SharedPtr tick_timer_, heartbeat_timer_;
};
}  // namespace rover
