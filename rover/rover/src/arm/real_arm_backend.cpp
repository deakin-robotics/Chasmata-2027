#include "real_arm_backend.hpp"
#include <algorithm>
#include <cmath>
#include <set>
#include <stdexcept>
#include <unordered_set>

namespace rover
{
namespace
{
using namespace std::chrono_literals;
constexpr std::array<const char *, 6> names{{"base_joint", "shoulder_joint", "elbow_joint", "yaw_joint", "pitch_joint", "roll_joint"}};
const std::set<std::string> proximal{"base_joint", "shoulder_joint", "elbow_joint"};
}
RealArmBackend::RealArmBackend(rclcpp::Node & node)
{
  const auto values = node.declare_parameter<std::vector<double>>("arm_manual_speed_rpm", std::vector<double>(6, 0.0));
  if (values.size() != names.size() || std::any_of(values.begin(), values.end(), [](double v) { return !std::isfinite(v) || v <= 0.0; }))
    throw std::invalid_argument("arm_manual_speed_rpm must contain six positive finite RPM values");
  std::copy(values.begin(), values.end(), speeds_.begin());
  command_ = node.create_publisher<dcr_arm_driver::msg::DirectDrive>("/arm/direct_drive", rclcpp::QoS(32));
  lease_ = node.create_publisher<std_msgs::msg::UInt64>("/arm/control/lease", 10);
  status_sub_ = node.create_subscription<Status>("/arm/control/status", rclcpp::QoS(10).reliable(),
    [this](const Status & status) { on_status(status); });
  joy_sub_ = node.create_subscription<sensor_msgs::msg::Joy>("/arm/joy", 10,
    [this](const sensor_msgs::msg::Joy & joy) { on_joy(joy); });
  lock_sub_ = node.create_subscription<std_msgs::msg::Bool>("/arm/orientation_lock", 10,
    [this](const std_msgs::msg::Bool & msg) { on_lock(msg.data); });
  handoff_ = node.create_client<Handoff>("/arm/control/handoff");
  controllers_ = node.create_client<List>("/controller_manager/list_controllers");
  gate_ = node.create_client<Gate>("/arm/control/trajectory_gate");
  client_ = rclcpp_action::create_client<Trajectory>(&node, "/arm_real_controller/follow_joint_trajectory");
  server_ = rclcpp_action::create_server<Trajectory>(&node, "/arm_controller/follow_joint_trajectory",
    std::bind(&RealArmBackend::on_goal, this, std::placeholders::_1, std::placeholders::_2),
    std::bind(&RealArmBackend::on_cancel, this, std::placeholders::_1),
    std::bind(&RealArmBackend::on_accepted, this, std::placeholders::_1));
  orientation_publisher_ = node.create_publisher<std_msgs::msg::UInt8>("/arm/position/ownership", rclcpp::QoS(1).reliable().transient_local());
  orientation_timer_ = node.create_wall_timer(100ms, [this] {
    std_msgs::msg::UInt8 msg;
    msg.data = valid_ && position_announced_ && active_mode_ == "POSITION" && transition_ == Transition::idle && confirmed() ? (active_lock_ ? 2 : 1) : 0;
    orientation_publisher_->publish(msg);
  });
  timer_ = node.create_wall_timer(50ms, [this] { tick(); });
}
bool RealArmBackend::valid_configuration() const
{
  const auto n = status_.joint_names.size();
  if (Clock::now() - status_time_ > 300ms || n == 0 || n > names.size() ||
      status_.joint_can_ids.size() != n || status_.joint_max_velocity_rpm.size() != n || status_.direct_request_ids.size() != n) return false;
  std::unordered_set<std::string> unique_names;
  std::unordered_set<uint32_t> unique_ids;
  for (size_t i = 0; i < n; ++i) {
    auto found = std::find_if(names.begin(), names.end(), [&](const char * name) { return status_.joint_names[i] == name; });
    if (found == names.end() || !unique_names.insert(status_.joint_names[i]).second ||
        !unique_ids.insert(status_.joint_can_ids[i]).second || status_.joint_can_ids[i] == 0 ||
        !std::isfinite(status_.joint_max_velocity_rpm[i]) || speeds_[found - names.begin()] > status_.joint_max_velocity_rpm[i]) return false;
  }
  return true;
}
bool RealArmBackend::ready() const { return status_.direct_ready && valid_configuration(); }
bool RealArmBackend::healthy() const
{
  return valid_configuration() && status_.hardware_active && status_.estop_clear &&
    status_.feedback_fresh && status_.motor_status_safe && status_.controller_ready;
}
bool RealArmBackend::acknowledgements(bool wrist_only) const
{
  if (!ready()) return false;
  for (size_t i = 0; i < status_.joint_names.size(); ++i) {
    if (wrist_only && proximal.count(status_.joint_names[i])) continue;
    if (status_.direct_request_ids[i] != request_id_) return false;
  }
  return true;
}
bool RealArmBackend::confirmed() const
{
  if (active_mode_ == "MANUAL") return status_.control_owner == 1 && acknowledgements(false);
  return active_mode_ == "POSITION" && healthy() && status_.control_owner == (active_lock_ ? 2 : 3) &&
    controller_active_ && Clock::now() - controller_time_ < 1s && client_->action_server_is_ready() && gate_->service_is_ready() &&
    (active_lock_ || acknowledgements(true));
}
void RealArmBackend::on_status(const Status & status) { status_ = status; status_time_ = Clock::now(); }
void RealArmBackend::on_joy(const sensor_msgs::msg::Joy & joy)
{
  if (joy.axes.size() < 10 || joy.buttons.size() <= 4 ||
      std::any_of(joy.axes.begin(), joy.axes.end(), [](float a) { return !std::isfinite(a) || a < -1.0 || a > 1.0; }) ||
      joy.axes[8] < 0 || joy.axes[9] < 0 ||
      std::any_of(joy.buttons.begin(), joy.buttons.end(), [](int b) { return b != 0 && b != 1; })) return;
  axes_ = {joy.axes[0], joy.axes[1], joy.buttons[4] ? 0.0 : joy.axes[4], joy.axes[6], joy.axes[7], joy.axes[9] - joy.axes[8]};
  joy_time_ = Clock::now();
}
void RealArmBackend::on_lock(bool locked)
{
  requested_lock_ = locked;
  if (valid_ && active_mode_ == "POSITION" && transition_ == Transition::idle && locked != active_lock_)
    start_transition("POSITION", false);
}
void RealArmBackend::start_transition(const std::string & target, bool report_result)
{
  target_mode_ = target;
  position_announced_ = false;
  report_result_ = report_result;
  pending_ = report_result;
  result_.reset();
  deadline_ = Clock::now() + 3s;
  transition_ = Transition::preparing;
  next_request_id_ = static_cast<uint64_t>(Clock::now().time_since_epoch().count());
  if (!next_request_id_) ++next_request_id_;
  if (active_mode_ == "POSITION") cancel_trajectory();
}
void RealArmBackend::request_mode(const std::string & mode)
{
  result_.reset();
  if (mode != "MANUAL" && mode != "POSITION") {
    if (transition_ != Transition::idle) cancel_mode_request();
    result_ = false; return;
  }
  if (transition_ != Transition::idle) {
    pending_ = true;
    if (mode == target_mode_) { queued_target_.reset(); report_result_ = true; }
    else { queued_target_ = mode; report_result_ = false; }
    return;
  }
  if (valid_ && active_mode_ == mode && (mode != "POSITION" || requested_lock_ == active_lock_) && confirmed()) {
    result_ = true; return;
  }
  start_transition(mode, true);
}
void RealArmBackend::cancel_mode_request()
{
  if (transition_ != Transition::idle) {
    if (sending_) send(true, active_mode_ == "POSITION");
    const bool previous_verified = transition_ == Transition::preparing && valid_ && confirmed();
    if (!previous_verified) { valid_ = false; sending_ = false; }
    else if (active_mode_ == "POSITION") position_announced_ = true;
  }
  transition_ = Transition::idle; pending_ = false; result_.reset(); queued_target_.reset();
}
std::optional<bool> RealArmBackend::take_mode_result()
{
  auto result = result_; result_.reset();
  if (result && *result && active_mode_ == "POSITION") position_announced_ = true;
  return result;
}
std::optional<std::string> RealArmBackend::take_mode_update()
{
  auto update = mode_update_; mode_update_.reset();
  if (update && *update == "POSITION") position_announced_ = true;
  return update;
}
void RealArmBackend::send(bool neutral, bool wrist_only)
{
  for (size_t i = 0; i < status_.joint_names.size(); ++i) {
    const auto found = std::find_if(names.begin(), names.end(), [&](const char * name) { return status_.joint_names[i] == name; });
    if (found == names.end() || i >= status_.joint_can_ids.size()) continue;
    const auto index = static_cast<size_t>(found - names.begin());
    if (wrist_only && index < 3) continue;
    dcr_arm_driver::msg::DirectDrive msg;
    msg.id = status_.joint_can_ids[i]; msg.mode = dcr_arm_driver::msg::DirectDrive::SPEED;
    msg.value = neutral ? 0.0 : axes_[index] * speeds_[index]; msg.request_id = request_id_;
    command_->publish(msg);
  }
}
void RealArmBackend::fail()
{
  if (sending_) send(true, active_mode_ == "POSITION");
  if (transition_ == Transition::handoff) valid_ = false;
  if (valid_ && !confirmed()) valid_ = false;
  if (!valid_) { sending_ = false; active_mode_.clear(); abort_trajectory("Arm ownership unavailable"); }
  if (queued_target_) {
    auto next = *queued_target_; queued_target_.reset();
    transition_ = Transition::idle;
    start_transition(next, true);
    return;
  }
  if (valid_ && active_mode_ == "POSITION") position_announced_ = true;
  if (report_result_ && pending_) result_ = false;
  pending_ = false; transition_ = Transition::idle;
}
void RealArmBackend::poll_controller()
{
  const auto now = Clock::now();
  if (controllers_future_.valid()) {
    if (controllers_future_.wait_for(0s) == std::future_status::ready) {
      const auto response = controllers_future_.get();
      controller_active_ = std::any_of(response->controller.begin(), response->controller.end(), [](const auto & c) {
        return c.name == "arm_real_controller" && c.state == "active";
      });
      controller_time_ = now;
      controllers_future_ = {};
    }
    return;
  }
  if (now >= next_controller_check_ && controllers_->service_is_ready()) {
    controllers_future_ = controllers_->async_send_request(std::make_shared<List::Request>()).future.share();
    next_controller_check_ = now + 250ms;
  }
}
void RealArmBackend::poll_trajectory_gate()
{
  if (forward_pending_) {
    if (!server_goal_) { forward_pending_ = false; return; }
    if (goal_cancel_requested_) { abort_trajectory("Trajectory canceled before forwarding"); return; }
    if (Clock::now() >= preflight_deadline_) { abort_trajectory("Trajectory hold was not acknowledged"); return; }
    if (!preflight_future_.valid()) {
      if (!gate_->service_is_ready()) return;
      auto request = std::make_shared<Gate::Request>();
      request->enable = false; request->request_id = request_id_;
      preflight_future_ = gate_->async_send_request(request).future.share();
      return;
    }
    if (preflight_future_.wait_for(0s) != std::future_status::ready) return;
    const bool success = preflight_future_.get()->success;
    preflight_future_ = {}; forward_pending_ = false;
    if (!success) { abort_trajectory("Trajectory hold was rejected"); return; }
    forward_goal(server_goal_);
  }
  if (!gate_pending_ || !server_goal_ || !client_goal_) return;
  if (goal_cancel_requested_) { gate_pending_ = false; return; }
  if (Clock::now() >= gate_deadline_) { gate_pending_ = false; abort_trajectory("Trajectory ownership was not acknowledged"); return; }
  if (gate_future_.valid()) {
    if (gate_future_.wait_for(0s) != std::future_status::ready) return;
    const bool success = gate_future_.get()->success;
    gate_future_ = {};
    if (success) { gate_accepted_ = true; gate_pending_ = false; return; }
  }
  if (!gate_->service_is_ready()) return;
  auto request = std::make_shared<Gate::Request>();
  request->enable = true;
  request->request_id = request_id_;
  request->goal_id = client_goal_->get_goal_id();
  gate_future_ = gate_->async_send_request(request).future.share();
}
void RealArmBackend::tick()
{
  const auto now = Clock::now();
  if (request_id_ != 0 && (valid_ || transition_ != Transition::idle)) {
    std_msgs::msg::UInt64 lease; lease.data = request_id_; lease_->publish(lease);
  }
  poll_trajectory_gate();
  if (active_mode_ == "POSITION" || target_mode_ == "POSITION") poll_controller();
  if (transition_ == Transition::idle) {
    if (!valid_) return;
    if (!confirmed()) { fail(); return; }
    if (active_mode_ == "POSITION" && requested_lock_ != active_lock_) {
      start_transition("POSITION", false);
      return;
    }
    if (active_mode_ == "MANUAL") send(now - joy_time_ > 250ms);
    else if (!active_lock_) send(now - joy_time_ > 250ms, true);
    return;
  }
  if (now >= deadline_) {
    // A completed rejection proves that ownership did not change. An
    // unanswered or successful handoff must instead invalidate the old mode.
    if (transition_ == Transition::handoff && handoff_future_.valid() &&
        handoff_future_.wait_for(0s) == std::future_status::ready) {
      const bool accepted = handoff_future_.get()->success;
      handoff_future_ = {};
      if (!accepted) transition_ = Transition::preparing;
    }
    fail(); return;
  }
  if (valid_ && !confirmed()) {
    valid_ = false;
    if (transition_ != Transition::handoff) { fail(); return; }
  }
  if (transition_ == Transition::manual_ack) {
    if (!ready()) return;
    if (sending_ && acknowledgements(false)) {
      active_mode_ = "MANUAL"; valid_ = true; transition_ = Transition::idle;
      if (queued_target_) {
        auto next = *queued_target_; queued_target_.reset();
        start_transition(next, true); send(true); return;
      }
      if (report_result_) result_ = true;
      pending_ = false; joy_time_ = {};
    }
    sending_ = true; send(true); return;
  }
  if (transition_ == Transition::preparing) {
    if (active_mode_ == "MANUAL" && valid_ && ready()) send(true);
    else if (active_mode_ == "POSITION" && valid_ && !active_lock_ && ready()) send(true, true);
    if (server_goal_) { cancel_trajectory(); return; }
    if (!handoff_->service_is_ready() || !healthy()) return;
    if (target_mode_ == "POSITION" && (!controller_active_ || now - controller_time_ >= 1s || !client_->action_server_is_ready() || !gate_->service_is_ready())) return;
    auto request = std::make_shared<Handoff::Request>();
    handoff_lock_ = requested_lock_;
    request->request_id = next_request_id_;
    request->mode = target_mode_ == "MANUAL" ? Handoff::Request::MANUAL :
      (handoff_lock_ ? Handoff::Request::POSITION_LOCKED : Handoff::Request::POSITION_UNLOCKED);
    handoff_future_ = handoff_->async_send_request(request).future.share();
    transition_ = Transition::handoff;
    return;
  }
  if (transition_ == Transition::handoff) {
    if (active_mode_ == "MANUAL" && valid_ && ready()) send(true);
    else if (active_mode_ == "POSITION" && valid_ && !active_lock_ && ready()) send(true, true);
    if (!handoff_future_.valid() || handoff_future_.wait_for(0s) != std::future_status::ready) return;
    if (!handoff_future_.get()->success) { transition_ = Transition::preparing; return; }
    valid_ = false; sending_ = false; joy_time_ = {};
    request_id_ = next_request_id_;
    active_lock_ = handoff_lock_;
    transition_ = target_mode_ == "MANUAL" ? Transition::manual_ack : Transition::verify;
    return;
  }
  if (transition_ == Transition::verify) {
    if (!healthy() || status_.control_owner != (active_lock_ ? 2 : 3) ||
        !controller_active_ || now - controller_time_ >= 1s || !client_->action_server_is_ready() || !gate_->service_is_ready()) return;
    if (!active_lock_) {
      if (!ready()) return;
      if (!sending_ || !acknowledgements(true)) { sending_ = true; send(true, true); return; }
    }
    active_mode_ = "POSITION"; valid_ = true; transition_ = Transition::idle; joy_time_ = {};
    if (queued_target_) {
      auto next = *queued_target_; queued_target_.reset();
      start_transition(next, true); return;
    }
    if (requested_lock_ != active_lock_) { start_transition("POSITION", report_result_); return; }
    if (report_result_) result_ = true;
    else mode_update_ = "POSITION";
    pending_ = false;
  }
}
rclcpp_action::GoalResponse RealArmBackend::on_goal(const rclcpp_action::GoalUUID &, std::shared_ptr<const Trajectory::Goal> goal)
{
  const auto & joint_names = goal->trajectory.joint_names;
  const std::set<std::string> actual(joint_names.begin(), joint_names.end());
  std::set<std::string> expected;
  for (const auto & name : status_.joint_names) if (active_lock_ || proximal.count(name)) expected.insert(name);
  if (!valid_ || !position_announced_ || active_mode_ != "POSITION" || transition_ != Transition::idle || !confirmed() || server_goal_ ||
      actual.size() != joint_names.size() || expected.empty() || actual != expected || goal->trajectory.points.empty())
    return rclcpp_action::GoalResponse::REJECT;
  return rclcpp_action::GoalResponse::ACCEPT_AND_EXECUTE;
}
rclcpp_action::CancelResponse RealArmBackend::on_cancel(const std::shared_ptr<ServerGoal>)
{
  cancel_trajectory(); return rclcpp_action::CancelResponse::ACCEPT;
}
void RealArmBackend::cancel_trajectory()
{
  if (!server_goal_ || goal_cancel_requested_) return;
  goal_cancel_requested_ = true;
  if (gate_->service_is_ready()) {
    auto request = std::make_shared<Gate::Request>();
    request->enable = false;
    request->request_id = request_id_;
    gate_->async_send_request(request);
  }
  if (client_goal_) client_->async_cancel_goal(client_goal_);
}
void RealArmBackend::abort_trajectory(const std::string & reason)
{
  if (!server_goal_) return;
  cancel_trajectory();
  if (server_goal_->is_active()) {
    auto result = std::make_shared<Trajectory::Result>();
    result->error_code = Trajectory::Result::INVALID_GOAL; result->error_string = reason;
    if (server_goal_->is_canceling()) server_goal_->canceled(result);
    else server_goal_->abort(result);
  }
  server_goal_.reset(); client_goal_.reset(); gate_pending_ = false; forward_pending_ = false; gate_future_ = {}; preflight_future_ = {};
}
void RealArmBackend::on_accepted(const std::shared_ptr<ServerGoal> goal)
{
  if (!valid_ || !position_announced_ || active_mode_ != "POSITION" || transition_ != Transition::idle || !confirmed()) {
    auto result = std::make_shared<Trajectory::Result>();
    result->error_code = Trajectory::Result::INVALID_GOAL;
    result->error_string = "Position ownership changed before forwarding";
    goal->abort(result);
    return;
  }
  server_goal_ = goal; client_goal_.reset(); goal_cancel_requested_ = false;
  gate_pending_ = false; gate_accepted_ = false; gate_future_ = {};
  forward_pending_ = true; preflight_future_ = {};
  preflight_deadline_ = Clock::now() + std::chrono::seconds(2);
}
void RealArmBackend::forward_goal(const std::shared_ptr<ServerGoal> goal)
{
  rclcpp_action::Client<Trajectory>::SendGoalOptions options;
  options.goal_response_callback = [this, goal](std::shared_ptr<ClientGoal> handle) {
    if (server_goal_ != goal) { if (handle) client_->async_cancel_goal(handle); return; }
    if (!handle) { abort_trajectory("Trajectory controller rejected the goal"); return; }
    client_goal_ = handle;
    if (goal_cancel_requested_) client_->async_cancel_goal(handle);
    else { gate_pending_ = true; gate_deadline_ = Clock::now() + std::chrono::seconds(2); }
  };
  options.feedback_callback = [this, goal](std::shared_ptr<ClientGoal>, const std::shared_ptr<const Trajectory::Feedback> feedback) {
    if (server_goal_ == goal && goal->is_active()) goal->publish_feedback(std::make_shared<Trajectory::Feedback>(*feedback));
  };
  options.result_callback = [this, goal](const ClientGoal::WrappedResult & wrapped) {
    if (server_goal_ != goal) return;
    auto result = wrapped.result ? std::make_shared<Trajectory::Result>(*wrapped.result) : std::make_shared<Trajectory::Result>();
    if (goal->is_canceling()) goal->canceled(result);
    else if (wrapped.code == rclcpp_action::ResultCode::SUCCEEDED && !goal_cancel_requested_ && gate_accepted_) goal->succeed(result);
    else {
      if (!gate_accepted_) { result->error_code = Trajectory::Result::INVALID_GOAL; result->error_string = "Trajectory ownership was not acknowledged"; }
      goal->abort(result);
    }
    server_goal_.reset(); client_goal_.reset(); goal_cancel_requested_ = false; gate_pending_ = false; gate_future_ = {};
  };
  auto forwarded = *goal->get_goal();
  if (!active_lock_) {
    // The controller fills missing joints in a partial goal and otherwise
    // applies its configured tolerances to the independently driven wrist.
    const auto release_wrist_tolerances = [this](auto & tolerances) {
      for (const auto & name : status_.joint_names) {
        if (proximal.count(name)) continue;
        tolerances.erase(std::remove_if(tolerances.begin(), tolerances.end(),
          [&name](const auto & tolerance) { return tolerance.name == name; }), tolerances.end());
        tolerances.emplace_back();
        auto found = std::prev(tolerances.end());
        found->name = name;
        found->position = found->velocity = found->acceleration = -1.0;
      }
    };
    release_wrist_tolerances(forwarded.path_tolerance);
    release_wrist_tolerances(forwarded.goal_tolerance);
  }
  client_->async_send_goal(forwarded, options);
}
}
