#pragma once

#include "../rover/rover_node_impl.hpp"
#include "rover/arm_backend.hpp"

namespace rover
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

class MockArmBackend final : public ArmBackend
{
public:
  MockArmBackend(rclcpp::Node & node, double delay_seconds);
  ~MockArmBackend() override;
  void request_mode(const std::string & mode) override;
  void cancel_mode_request() override;
  std::optional<bool> take_mode_result() override;
  void tick() override { publish_joint_state(); }
private:
  void on_joint_command(const sensor_msgs::msg::JointState::SharedPtr message);
  void on_joy(const sensor_msgs::msg::Joy & message);
  void apply_deltas(const JointSimulator::JointValues & deltas, double speed);
  rclcpp_action::GoalResponse handle_goal(const rclcpp_action::GoalUUID &, std::shared_ptr<const FollowJointTrajectory::Goal> goal);
  rclcpp_action::CancelResponse handle_cancel(const std::shared_ptr<GoalHandleTrajectory>);
  void handle_accepted(const std::shared_ptr<GoalHandleTrajectory> goal_handle);
  void abort(const std::shared_ptr<GoalHandleTrajectory> & goal_handle, int32_t code, const std::string & message);
  void execute_trajectory(const std::shared_ptr<GoalHandleTrajectory> & goal_handle);
  void publish_joint_state();
  JointSimulator joints_;
  std::recursive_mutex joints_mutex_;
  std::mutex trajectory_mutex_;
  struct TrajectoryWorker { std::thread thread; std::shared_ptr<std::atomic<bool>> finished; };
  std::vector<TrajectoryWorker> trajectory_workers_;
  std::atomic<bool> stopping_{false};
  rclcpp::Node & node_;
  std::chrono::steady_clock::duration delay_;
  std::optional<std::chrono::steady_clock::time_point> due_;
  std::string requested_mode_, arm_mode_;
  std::atomic<bool> orientation_locked_{false};
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr joint_state_publisher_;
  std::vector<rclcpp::SubscriptionBase::SharedPtr> subscriptions_;
  rclcpp_action::Server<FollowJointTrajectory>::SharedPtr trajectory_server_;
};
}  // namespace rover
