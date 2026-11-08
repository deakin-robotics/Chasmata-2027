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

#include "mock_rover/joint_simulator.hpp"
#include "mock_rover/drive_backend.hpp"
#include "mock_rover/mock_rover_node.hpp"

namespace mock_rover
{
using FollowJointTrajectory = control_msgs::action::FollowJointTrajectory;
using GoalHandleTrajectory = rclcpp_action::ServerGoalHandle<FollowJointTrajectory>;
inline constexpr std::array<const char *, 6> kJointNames{
  "base_joint", "shoulder_joint", "elbow_joint", "yaw_joint", "pitch_joint", "roll_joint"};
inline const std::set<std::string> kProximal{"base_joint", "shoulder_joint", "elbow_joint"};
inline const std::set<std::string> kAllJoints(kJointNames.begin(), kJointNames.end());
inline const JointSimulator::JointLimits kJointLimits{
  {"base_joint", {-3.228859116, 3.228859116}}, {"shoulder_joint", {-0.087266463, 3.228859116}},
  {"elbow_joint", {-0.087266463, 4.799655442}}, {"yaw_joint", {-1.658062789, 3.228859116}},
  {"pitch_joint", {-0.087266463, 3.752457891}}, {"roll_joint", {-3.228859116, 3.228859116}}};

class MockRoverNode : public rclcpp::Node
{
public:
  explicit MockRoverNode(std::unique_ptr<DriveBackend> drive_backend);
  ~MockRoverNode() override;

private:
  struct Pending { std::string value; std::chrono::steady_clock::time_point due; };

  void request_mode(const std::string & subsystem, const std::string & raw_mode);
  void request_override(const std::string & raw);
  void request_gimbal(const std::string & raw);
  std::chrono::steady_clock::time_point due_time() const;
  void on_joint_command(const sensor_msgs::msg::JointState::SharedPtr message);
  void on_joy(const std::string & subsystem, const sensor_msgs::msg::Joy & message, size_t left_trigger, size_t right_trigger);
  void apply_deltas(const JointSimulator::JointValues & deltas, double speed);
  rclcpp_action::GoalResponse handle_goal(const rclcpp_action::GoalUUID &, std::shared_ptr<const FollowJointTrajectory::Goal> goal);
  rclcpp_action::CancelResponse handle_cancel(const std::shared_ptr<GoalHandleTrajectory>);
  void handle_accepted(const std::shared_ptr<GoalHandleTrajectory> goal_handle);
  void abort(const std::shared_ptr<GoalHandleTrajectory> & goal_handle, int32_t code, const std::string & message);
  void execute_trajectory(const std::shared_ptr<GoalHandleTrajectory> & goal_handle);
  void tick();
  void publish_fma();
  telemetry_interfaces::msg::FmaModeState mode_state(const std::string & subsystem, const std::string & confirmed) const;
  void publish_joint_state();
  void publish_heartbeat();

  JointSimulator joints_;
  std::unique_ptr<DriveBackend> drive_backend_;
  std::recursive_mutex joints_mutex_;
  std::mutex trajectory_mutex_;
  struct TrajectoryWorker { std::thread thread; std::shared_ptr<std::atomic<bool>> finished; };
  std::vector<TrajectoryWorker> trajectory_workers_;
  std::atomic<bool> stopping_{false};
  double ack_delay_{0.15}; std::atomic<bool> orientation_locked_{false};
  std::string drive_mode_, arm_mode_, law_{"NORMAL"}, override_state_{"INACTIVE"}, gimbal_priority_;
  bool rover_protection_{true}; uint64_t sequence_{0}; std::chrono::steady_clock::time_point last_fma_{std::chrono::steady_clock::now()};
  std::map<std::string, Pending> pending_modes_; std::map<std::string, std::string> rejected_modes_;
  std::map<std::string, std::chrono::steady_clock::time_point> rejection_clear_;
  std::optional<Pending> pending_override_, pending_gimbal_;
  const std::set<std::string> drive_modes_{"MANUAL", "VELOCITY", "MANAGED"};
  const std::set<std::string> arm_modes_{"MANUAL", "POSITION", "MANAGED", "STOWED"};
  rclcpp::Publisher<telemetry_interfaces::msg::FmaState>::SharedPtr fma_publisher_;
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr joint_state_publisher_;
  rclcpp::Publisher<std_msgs::msg::Empty>::SharedPtr heartbeat_publisher_;
  std::vector<rclcpp::SubscriptionBase::SharedPtr> subscriptions_;
  rclcpp_action::Server<FollowJointTrajectory>::SharedPtr trajectory_server_;
  rclcpp::TimerBase::SharedPtr tick_timer_, heartbeat_timer_;
};
}  // namespace mock_rover
