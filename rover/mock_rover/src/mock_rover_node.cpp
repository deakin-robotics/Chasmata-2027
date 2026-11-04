#include <algorithm>
#include <array>
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

namespace mock_rover
{
namespace
{
using FollowJointTrajectory = control_msgs::action::FollowJointTrajectory;
using GoalHandleTrajectory = rclcpp_action::ServerGoalHandle<FollowJointTrajectory>;
constexpr std::array<const char *, 6> kJointNames{
  "base_joint", "shoulder_joint", "elbow_joint", "yaw_joint", "pitch_joint", "roll_joint"};
const std::set<std::string> kProximal{"base_joint", "shoulder_joint", "elbow_joint"};
const std::set<std::string> kAllJoints(kJointNames.begin(), kJointNames.end());
const JointSimulator::JointLimits kJointLimits{
  {"base_joint", {-3.228859116, 3.228859116}}, {"shoulder_joint", {-0.087266463, 3.228859116}},
  {"elbow_joint", {-0.087266463, 4.799655442}}, {"yaw_joint", {-1.658062789, 3.228859116}},
  {"pitch_joint", {-0.087266463, 3.752457891}}, {"roll_joint", {-3.228859116, 3.228859116}}};

std::string upper_trimmed(std::string value)
{
  const auto first = value.find_first_not_of(" \t\n\r");
  const auto last = value.find_last_not_of(" \t\n\r");
  value = first == std::string::npos ? "" : value.substr(first, last - first + 1);
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char character) {
    return static_cast<char>(std::toupper(character));
  });
  return value;
}

double seconds(const builtin_interfaces::msg::Duration & duration)
{
  return static_cast<double>(duration.sec) + static_cast<double>(duration.nanosec) / 1e9;
}
}  // namespace

class MockRoverNode : public rclcpp::Node
{
public:
  MockRoverNode()
  : Node("mock_rover"), joints_(std::vector<std::string>(kJointNames.begin(), kJointNames.end()), kJointLimits, 1.0)
  {
    declare_parameter<double>("publish_rate_hz", 10.0);
    declare_parameter<double>("mode_ack_delay_ms", 150.0);
    const auto rate = std::max(get_parameter("publish_rate_hz").as_double(), 1.0);
    ack_delay_ = std::max(get_parameter("mode_ack_delay_ms").as_double() / 1000.0, 0.0);

    const auto retained = rclcpp::QoS(rclcpp::KeepLast(1)).reliable().transient_local();
    fma_publisher_ = create_publisher<telemetry_interfaces::msg::FmaState>("/fma/state", retained);
    joint_state_publisher_ = create_publisher<sensor_msgs::msg::JointState>("/arm/joint_states", 10);
    heartbeat_publisher_ = create_publisher<std_msgs::msg::Empty>("/rover/heartbeat",
      rclcpp::QoS(rclcpp::KeepLast(1)).reliable());

    subscriptions_.push_back(create_subscription<sensor_msgs::msg::JointState>("/arm/joint_commands", 10,
      std::bind(&MockRoverNode::on_joint_command, this, std::placeholders::_1)));
    subscriptions_.push_back(create_subscription<sensor_msgs::msg::Joy>("/drive/joy", 10,
      [this](sensor_msgs::msg::Joy::SharedPtr message) { on_joy("drive", *message, 4, 5); }));
    subscriptions_.push_back(create_subscription<sensor_msgs::msg::Joy>("/arm/joy", 10,
      [this](sensor_msgs::msg::Joy::SharedPtr message) { on_joy("arm", *message, 8, 9); }));
    subscriptions_.push_back(create_subscription<std_msgs::msg::Bool>("/arm/orientation_lock", 10,
      [this](std_msgs::msg::Bool::SharedPtr message) { orientation_locked_ = message->data; }));
    subscriptions_.push_back(create_subscription<std_msgs::msg::String>("/fma/drive/request", 10,
      [this](std_msgs::msg::String::SharedPtr message) { request_mode("drive", message->data); }));
    subscriptions_.push_back(create_subscription<std_msgs::msg::String>("/fma/arm/request", 10,
      [this](std_msgs::msg::String::SharedPtr message) { request_mode("arm", message->data); }));
    subscriptions_.push_back(create_subscription<std_msgs::msg::String>("/arm/override/request", 10,
      [this](std_msgs::msg::String::SharedPtr message) { request_override(message->data); }));
    subscriptions_.push_back(create_subscription<std_msgs::msg::String>("/fma/gimbal/request", 10,
      [this](std_msgs::msg::String::SharedPtr message) { request_gimbal(message->data); }));

    trajectory_server_ = rclcpp_action::create_server<FollowJointTrajectory>(this,
      "/arm_controller/follow_joint_trajectory",
      std::bind(&MockRoverNode::handle_goal, this, std::placeholders::_1, std::placeholders::_2),
      std::bind(&MockRoverNode::handle_cancel, this, std::placeholders::_1),
      std::bind(&MockRoverNode::handle_accepted, this, std::placeholders::_1));
    tick_timer_ = create_wall_timer(std::chrono::duration<double>(1.0 / rate),
      std::bind(&MockRoverNode::tick, this));
    heartbeat_timer_ = create_wall_timer(std::chrono::seconds(1), [this]() { publish_heartbeat(); });
    publish_fma();
    publish_joint_state();
    publish_heartbeat();
  }

private:
  struct Pending { std::string value; std::chrono::steady_clock::time_point due; };

  void request_mode(const std::string & subsystem, const std::string & raw_mode)
  {
    const auto mode = upper_trimmed(raw_mode);
    const auto & valid = subsystem == "drive" ? drive_modes_ : arm_modes_;
    if (valid.count(mode) == 0) {
      rejected_modes_[subsystem] = mode;
      pending_modes_.erase(subsystem);
      rejection_clear_[subsystem] = std::chrono::steady_clock::now() + std::chrono::milliseconds(500);
    } else {
      rejected_modes_.erase(subsystem);
      rejection_clear_.erase(subsystem);
      pending_modes_[subsystem] = Pending{mode, std::chrono::steady_clock::now() +
        std::chrono::duration_cast<std::chrono::steady_clock::duration>(std::chrono::duration<double>(ack_delay_))};
    }
    publish_fma();
  }

  void request_override(const std::string & raw)
  {
    const auto command = upper_trimmed(raw);
    if (command == "ENABLE" || command == "DISABLE") {
      pending_override_ = Pending{command, due_time()};
      publish_fma();
    }
  }

  void request_gimbal(const std::string & raw)
  {
    const auto owner = upper_trimmed(raw);
    if (owner == "DRIVER" || owner == "ARM OPS") {
      pending_gimbal_ = Pending{owner, due_time()};
      publish_fma();
    }
  }

  std::chrono::steady_clock::time_point due_time() const
  {
    return std::chrono::steady_clock::now() +
      std::chrono::duration_cast<std::chrono::steady_clock::duration>(std::chrono::duration<double>(ack_delay_));
  }

  void on_joint_command(const sensor_msgs::msg::JointState::SharedPtr message)
  {
    if (message->position.empty()) return;
    JointSimulator::JointValues values;
    if (!message->name.empty()) {
      if (message->name.size() != message->position.size()) return;
      for (size_t index = 0; index < message->name.size(); ++index) values[message->name[index]] = message->position[index];
    } else if (message->position.size() == kJointNames.size()) {
      for (size_t index = 0; index < kJointNames.size(); ++index) values[kJointNames[index]] = message->position[index];
    } else return;
    {
      std::lock_guard<std::recursive_mutex> lock(joints_mutex_);
      joints_.set_target_immediately(values);
    }
    publish_joint_state();
  }

  void on_joy(const std::string & subsystem, const sensor_msgs::msg::Joy & message, size_t left_trigger, size_t right_trigger)
  {
    if (message.axes.size() <= right_trigger) return;
    for (const auto axis : {message.axes[left_trigger], message.axes[right_trigger]}) {
      if (!std::isfinite(axis) || axis < 0.0 || axis > 1.0) return;
    }
    if (std::any_of(message.buttons.begin(), message.buttons.end(), [](int32_t value) { return value != 0 && value != 1; })) return;
    if (subsystem != "arm") return;
    if (arm_mode_ == "MANUAL") {
      const bool gimbal_held = message.buttons.size() > 4 && message.buttons[4] > 0;
      apply_deltas({{"base_joint", message.axes[0]}, {"shoulder_joint", message.axes[1]},
        {"elbow_joint", gimbal_held ? 0.0 : message.axes[4]}, {"yaw_joint", message.axes[6]},
        {"pitch_joint", message.axes[7]}, {"roll_joint", message.axes[9] - message.axes[8]}}, 0.5);
    } else if (arm_mode_ == "POSITION" && !orientation_locked_) {
      apply_deltas({{"yaw_joint", message.axes[6]}, {"pitch_joint", message.axes[7]},
        {"roll_joint", message.axes[9] - message.axes[8]}}, 0.5);
    }
  }

  void apply_deltas(const JointSimulator::JointValues & deltas, double speed)
  {
    JointSimulator::JointValues targets;
    {
      std::lock_guard<std::recursive_mutex> lock(joints_mutex_);
      const auto current = joints_.positions();
      for (const auto & [name, value] : deltas) if (value != 0.0) targets[name] = current.at(name) + value * speed * 0.02;
      if (targets.empty()) return;
      joints_.set_target_immediately(targets);
    }
    publish_joint_state();
  }

  rclcpp_action::GoalResponse handle_goal(const rclcpp_action::GoalUUID &, std::shared_ptr<const FollowJointTrajectory::Goal> goal)
  {
    return goal->trajectory.joint_names.empty() || goal->trajectory.points.empty() ?
      rclcpp_action::GoalResponse::REJECT : rclcpp_action::GoalResponse::ACCEPT_AND_EXECUTE;
  }
  rclcpp_action::CancelResponse handle_cancel(const std::shared_ptr<GoalHandleTrajectory>)
  {
    return rclcpp_action::CancelResponse::ACCEPT;
  }
  void handle_accepted(const std::shared_ptr<GoalHandleTrajectory> goal_handle)
  {
    std::thread([this, goal_handle]() { execute_trajectory(goal_handle); }).detach();
  }

  void abort(const std::shared_ptr<GoalHandleTrajectory> & goal_handle, int32_t code, const std::string & message)
  {
    auto result = std::make_shared<FollowJointTrajectory::Result>();
    result->error_code = code;
    result->error_string = message;
    goal_handle->abort(result);
  }

  void execute_trajectory(const std::shared_ptr<GoalHandleTrajectory> & goal_handle)
  {
    std::lock_guard<std::mutex> execution_lock(trajectory_mutex_);
    const auto trajectory = goal_handle->get_goal()->trajectory;
    const auto names = trajectory.joint_names;
    const std::set<std::string> name_set(names.begin(), names.end());
    const bool partial = std::all_of(name_set.begin(), name_set.end(), [](const std::string & name) { return kProximal.count(name) > 0; });
    const bool full = name_set == kAllJoints;
    if (name_set.size() != names.size() || !(partial || full) || (orientation_locked_ && !full)) {
      abort(goal_handle, FollowJointTrajectory::Result::INVALID_JOINTS,
        "The trajectory must contain J1-J3 when orientation is unlocked or all six joints when orientation is locked.");
      return;
    }
    double previous_time = 0.0;
    for (const auto & point : trajectory.points) {
      const auto point_time = seconds(point.time_from_start);
      if (point_time < previous_time || point.positions.size() != names.size()) {
        abort(goal_handle, FollowJointTrajectory::Result::INVALID_GOAL, "The trajectory points have invalid timing or positions."); return;
      }
      for (size_t index = 0; index < names.size(); ++index) {
        const auto limit = kJointLimits.at(names[index]);
        if (!std::isfinite(point.positions[index]) || point.positions[index] < limit.first || point.positions[index] > limit.second) {
          abort(goal_handle, FollowJointTrajectory::Result::INVALID_GOAL, "Trajectory exceeds a joint limit."); return;
        }
      }
      previous_time = point_time;
    }
    if (previous_time <= 0.0) { abort(goal_handle, FollowJointTrajectory::Result::INVALID_GOAL, "The trajectory must have a positive duration."); return; }
    auto result = std::make_shared<FollowJointTrajectory::Result>();
    std::lock_guard<std::recursive_mutex> joints_lock(joints_mutex_);
    auto previous_positions = joints_.positions();
    std::vector<double> previous;
    for (const auto & name : names) previous.push_back(previous_positions.at(name));
    const auto started = std::chrono::steady_clock::now();
    double previous_point = 0.0;
    for (const auto & point : trajectory.points) {
      const auto target_time = seconds(point.time_from_start);
      const auto segment = target_time - previous_point;
      while (true) {
        if (goal_handle->is_canceling()) { result->error_code = FollowJointTrajectory::Result::INVALID_GOAL; result->error_string = "The trajectory was cancelled during execution."; goal_handle->canceled(result); return; }
        const auto elapsed = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
        const auto fraction = segment <= 0.0 ? 1.0 : std::clamp((elapsed - previous_point) / segment, 0.0, 1.0);
        JointSimulator::JointValues values, velocities;
        std::vector<double> actual;
        for (size_t index = 0; index < names.size(); ++index) {
          const auto value = previous[index] + (point.positions[index] - previous[index]) * fraction;
          values[names[index]] = value;
          velocities[names[index]] = segment <= 0.0 ? 0.0 : (point.positions[index] - previous[index]) / segment;
          actual.push_back(value);
        }
        joints_.set_actual_positions(values, velocities);
        publish_joint_state();
        auto feedback = std::make_shared<FollowJointTrajectory::Feedback>();
        feedback->joint_names = names;
        feedback->actual.positions = actual;
        for (const auto & name : names) feedback->actual.velocities.push_back(velocities[name]);
        goal_handle->publish_feedback(feedback);
        if (fraction >= 1.0) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
      }
      previous_point = target_time;
      previous.assign(point.positions.begin(), point.positions.end());
    }
    result->error_code = FollowJointTrajectory::Result::SUCCESSFUL;
    goal_handle->succeed(result);
  }

  void tick()
  {
    const auto now = std::chrono::steady_clock::now();
    for (const auto & subsystem : {std::string("drive"), std::string("arm")}) {
      const auto pending = pending_modes_.find(subsystem);
      if (pending != pending_modes_.end() && pending->second.due <= now) {
        if (subsystem == "drive") drive_mode_ = pending->second.value; else arm_mode_ = pending->second.value;
        pending_modes_.erase(pending); publish_fma();
      }
    }
    if (pending_override_ && pending_override_->due <= now) {
      override_state_ = pending_override_->value == "ENABLE" ? "ACTIVE" : "INACTIVE";
      rover_protection_ = override_state_ != "ACTIVE";
      law_ = rover_protection_ ? "NORMAL" : "DIRECT";
      pending_override_.reset(); publish_fma();
    }
    if (pending_gimbal_ && pending_gimbal_->due <= now) { gimbal_priority_ = pending_gimbal_->value; pending_gimbal_.reset(); publish_fma(); }
    for (auto iterator = rejection_clear_.begin(); iterator != rejection_clear_.end();) {
      if (iterator->second <= now) { rejected_modes_.erase(iterator->first); iterator = rejection_clear_.erase(iterator); publish_fma(); } else ++iterator;
    }
    publish_joint_state();
    if (std::chrono::duration<double>(now - last_fma_).count() >= 1.0) publish_fma();
  }

  void publish_fma()
  {
    telemetry_interfaces::msg::FmaState message;
    message.schema = "dcr/fma-state/v1"; message.sequence = ++sequence_; message.law = law_; message.system = "GOOD";
    message.drive = mode_state("drive", drive_mode_); message.arm = mode_state("arm", arm_mode_);
    message.arm_override.state = override_state_; message.arm_override.pending = pending_override_ ? pending_override_->value : "";
    message.gimbal_priority.confirmed = gimbal_priority_; message.gimbal_priority.pending = pending_gimbal_ ? pending_gimbal_->value : "";
    message.gimbal_priority.rejected = "";
    fma_publisher_->publish(message); last_fma_ = std::chrono::steady_clock::now();
  }
  telemetry_interfaces::msg::FmaModeState mode_state(const std::string & subsystem, const std::string & confirmed) const
  {
    telemetry_interfaces::msg::FmaModeState state;
    state.confirmed = confirmed;
    const auto pending = pending_modes_.find(subsystem); state.pending = pending == pending_modes_.end() ? "" : pending->second.value;
    const auto rejected = rejected_modes_.find(subsystem); state.rejected = rejected == rejected_modes_.end() ? "" : rejected->second;
    return state;
  }
  void publish_joint_state()
  {
    std::lock_guard<std::recursive_mutex> lock(joints_mutex_);
    sensor_msgs::msg::JointState message; message.header.stamp = get_clock()->now();
    const auto positions = joints_.positions(); const auto velocities = joints_.velocities();
    for (const auto * name : kJointNames) { message.name.emplace_back(name); message.position.push_back(positions.at(name)); message.velocity.push_back(velocities.at(name)); }
    joint_state_publisher_->publish(message);
  }
  void publish_heartbeat() { heartbeat_publisher_->publish(std_msgs::msg::Empty{}); }

  JointSimulator joints_;
  std::recursive_mutex joints_mutex_;
  std::mutex trajectory_mutex_;
  double ack_delay_{0.15}; bool orientation_locked_{false};
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

int main(int argc, char * argv[])
{
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<mock_rover::MockRoverNode>());
  rclcpp::shutdown();
  return 0;
}
