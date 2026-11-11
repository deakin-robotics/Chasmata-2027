#pragma once

#include <array>
#include <chrono>
#include <optional>
#include <string>
#include <vector>
#include <rclcpp/rclcpp.hpp>
#include <rclcpp_action/rclcpp_action.hpp>
#include <control_msgs/action/follow_joint_trajectory.hpp>
#include <controller_manager_msgs/srv/list_controllers.hpp>
#include <sensor_msgs/msg/joy.hpp>
#include <std_msgs/msg/bool.hpp>
#include <std_msgs/msg/u_int8.hpp>
#include <std_msgs/msg/u_int64.hpp>
#include <dcr_arm_driver/msg/direct_drive.hpp>
#include <dcr_arm_driver/srv/arm_handoff.hpp>
#include <dcr_arm_driver/srv/arm_trajectory_gate.hpp>
#include <telemetry_interfaces/msg/arm_control_status.hpp>
#include "rover/arm_backend.hpp"

namespace rover
{
class RealArmBackend final : public ArmBackend
{
public:
  explicit RealArmBackend(rclcpp::Node & node);
  void request_mode(const std::string & mode) override;
  void cancel_mode_request() override;
  std::optional<bool> take_mode_result() override;
  bool confirmed_mode_valid() const override { return valid_; }
  std::optional<std::string> take_mode_update() override;
  void tick() override;
private:
  using Clock = std::chrono::steady_clock;
  using Status = telemetry_interfaces::msg::ArmControlStatus;
  using Handoff = dcr_arm_driver::srv::ArmHandoff;
  using List = controller_manager_msgs::srv::ListControllers;
  using Gate = dcr_arm_driver::srv::ArmTrajectoryGate;
  using Trajectory = control_msgs::action::FollowJointTrajectory;
  using ServerGoal = rclcpp_action::ServerGoalHandle<Trajectory>;
  using ClientGoal = rclcpp_action::ClientGoalHandle<Trajectory>;
  enum class Transition { idle, preparing, handoff, verify, manual_ack };
  void on_status(const Status & status);
  void on_joy(const sensor_msgs::msg::Joy & joy);
  void on_lock(bool locked);
  void send(bool neutral, bool wrist_only = false);
  bool valid_configuration() const;
  bool ready() const;
  bool healthy() const;
  bool confirmed() const;
  bool acknowledgements(bool wrist_only) const;
  void fail();
  void start_transition(const std::string & target, bool report_result);
  void poll_controller();
  void poll_trajectory_gate();
  rclcpp_action::GoalResponse on_goal(const rclcpp_action::GoalUUID &, std::shared_ptr<const Trajectory::Goal> goal);
  rclcpp_action::CancelResponse on_cancel(const std::shared_ptr<ServerGoal> goal);
  void on_accepted(const std::shared_ptr<ServerGoal> goal);
  void forward_goal(const std::shared_ptr<ServerGoal> goal);
  void cancel_trajectory();
  void abort_trajectory(const std::string & reason);
  rclcpp::Publisher<dcr_arm_driver::msg::DirectDrive>::SharedPtr command_;
  rclcpp::Publisher<std_msgs::msg::UInt64>::SharedPtr lease_;
  rclcpp::Publisher<std_msgs::msg::UInt8>::SharedPtr orientation_publisher_;
  rclcpp::Subscription<Status>::SharedPtr status_sub_;
  rclcpp::Subscription<sensor_msgs::msg::Joy>::SharedPtr joy_sub_;
  rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr lock_sub_;
  rclcpp::Client<Handoff>::SharedPtr handoff_;
  rclcpp::Client<List>::SharedPtr controllers_;
  rclcpp::Client<Gate>::SharedPtr gate_;
  rclcpp::Client<Handoff>::SharedFuture handoff_future_;
  rclcpp::Client<List>::SharedFuture controllers_future_;
  rclcpp::Client<Gate>::SharedFuture gate_future_, preflight_future_;
  rclcpp_action::Server<Trajectory>::SharedPtr server_;
  rclcpp_action::Client<Trajectory>::SharedPtr client_;
  std::shared_ptr<ServerGoal> server_goal_;
  std::shared_ptr<ClientGoal> client_goal_;
  rclcpp::TimerBase::SharedPtr timer_, orientation_timer_;
  std::array<double, 6> speeds_{};
  std::array<double, 6> axes_{};
  Status status_;
  Clock::time_point status_time_{}, joy_time_{}, deadline_{}, next_controller_check_{}, controller_time_{}, gate_deadline_{}, preflight_deadline_{};
  uint64_t request_id_{0}, next_request_id_{0};
  bool valid_{false}, sending_{false}, requested_lock_{false}, active_lock_{false};
  bool pending_{false}, report_result_{false}, controller_active_{false}, goal_cancel_requested_{false}, handoff_lock_{false}, gate_pending_{false}, gate_accepted_{false}, forward_pending_{false}, position_announced_{false};
  std::string active_mode_, target_mode_;
  Transition transition_{Transition::idle};
  std::optional<bool> result_;
  std::optional<std::string> mode_update_;
  std::optional<std::string> queued_target_;
};
}
