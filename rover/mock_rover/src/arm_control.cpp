#include "mock_rover_node_impl.hpp"

namespace mock_rover
{
void MockRoverNode::on_joint_command(const sensor_msgs::msg::JointState::SharedPtr message)
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

void MockRoverNode::on_joy(const std::string & subsystem, const sensor_msgs::msg::Joy & message, size_t left_trigger, size_t right_trigger)
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

void MockRoverNode::apply_deltas(const JointSimulator::JointValues & deltas, double speed)
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
}  // namespace mock_rover
