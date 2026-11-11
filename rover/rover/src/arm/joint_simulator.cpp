#include "rover/joint_simulator.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace rover
{
JointSimulator::JointSimulator(std::vector<std::string> joint_names, JointLimits joint_limits,
  double max_speed_rad_s)
: joint_names_(std::move(joint_names)), joint_limits_(std::move(joint_limits)),
  max_speed_rad_s_(max_speed_rad_s)
{
  if (max_speed_rad_s_ <= 0.0) throw std::invalid_argument("max_speed_rad_s must be greater than zero");
  for (const auto & name : joint_names_) {
    const auto found = joint_limits_.find(name);
    if (found == joint_limits_.end() || found->second.first > found->second.second) {
      throw std::invalid_argument("Invalid limits for " + name);
    }
    const auto initial = std::clamp(0.0, found->second.first, found->second.second);
    positions_[name] = initial;
    targets_[name] = initial;
    velocities_[name] = 0.0;
  }
}

JointSimulator::JointValues JointSimulator::set_target(const JointValues & values)
{
  JointValues accepted;
  for (const auto & [name, value] : values) {
    const auto limit = joint_limits_.find(name);
    if (limit == joint_limits_.end() || !std::isfinite(value)) continue;
    const auto bounded = std::clamp(value, limit->second.first, limit->second.second);
    targets_[name] = bounded;
    accepted[name] = bounded;
  }
  return accepted;
}

JointSimulator::JointValues JointSimulator::set_target_immediately(const JointValues & values)
{
  const auto accepted = set_target(values);
  for (const auto & [name, value] : accepted) {
    positions_[name] = value;
    velocities_[name] = 0.0;
  }
  return accepted;
}

JointSimulator::JointValues JointSimulator::set_actual_positions(const JointValues & values,
  const JointValues & velocities)
{
  const auto accepted = set_target(values);
  for (const auto & [name, value] : accepted) {
    positions_[name] = value;
    const auto velocity = velocities.find(name);
    velocities_[name] = velocity == velocities.end() ? 0.0 : velocity->second;
  }
  return accepted;
}

void JointSimulator::step(double elapsed_seconds)
{
  if (elapsed_seconds <= 0.0) return;
  const auto max_delta = max_speed_rad_s_ * elapsed_seconds;
  for (const auto & name : joint_names_) {
    const auto delta = targets_[name] - positions_[name];
    const auto movement = std::clamp(delta, -max_delta, max_delta);
    positions_[name] += movement;
    velocities_[name] = movement / elapsed_seconds;
    if (std::abs(targets_[name] - positions_[name]) < 1e-9) {
      positions_[name] = targets_[name];
      velocities_[name] = 0.0;
    }
  }
}

JointSimulator::JointValues JointSimulator::positions() const { return positions_; }
JointSimulator::JointValues JointSimulator::velocities() const { return velocities_; }
}  // namespace rover
