#include "rover_node_impl.hpp"

namespace rover
{
namespace
{
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
}  // namespace

void RoverNode::request_mode(const std::string & subsystem, const std::string & raw_mode)
{
  const auto mode = upper_trimmed(raw_mode);
  const auto & valid = subsystem == "drive" ? drive_modes_ : arm_modes_;
  if (valid.count(mode) == 0) {
    if (subsystem == "drive") {
      drive_backend_->cancel_mode_request();
      if (!drive_backend_->confirmed_mode_valid()) drive_mode_.clear();
    }
    if (subsystem == "arm") arm_backend_->cancel_mode_request();
    rejected_modes_[subsystem] = mode;
    pending_modes_.erase(subsystem);
    rejection_clear_[subsystem] = std::chrono::steady_clock::now() + std::chrono::milliseconds(500);
  } else {
    rejected_modes_.erase(subsystem);
    rejection_clear_.erase(subsystem);
    pending_modes_[subsystem] = Pending{mode, std::chrono::steady_clock::now() +
      std::chrono::duration_cast<std::chrono::steady_clock::duration>(std::chrono::duration<double>(ack_delay_))};
    if (subsystem == "drive") drive_backend_->request_mode(mode);
    else arm_backend_->request_mode(mode);
  }
  publish_fma();
}

void RoverNode::request_override(const std::string & raw)
{
  const auto command = upper_trimmed(raw);
  if (command == "ENABLE" || command == "DISABLE") {
    pending_override_ = Pending{command, due_time()};
    publish_fma();
  }
}

void RoverNode::request_gimbal(const std::string & raw)
{
  const auto owner = upper_trimmed(raw);
  if (owner == "DRIVER" || owner == "ARM OPS") {
    pending_gimbal_ = Pending{owner, due_time()};
    publish_fma();
  }
}

std::chrono::steady_clock::time_point RoverNode::due_time() const
{
  return std::chrono::steady_clock::now() +
    std::chrono::duration_cast<std::chrono::steady_clock::duration>(std::chrono::duration<double>(ack_delay_));
}

void RoverNode::tick()
{
  const auto now = std::chrono::steady_clock::now();
  for (const auto & subsystem : {std::string("drive"), std::string("arm")}) {
    const auto pending = pending_modes_.find(subsystem);
    if (pending == pending_modes_.end()) continue;
    if (subsystem == "drive") {
      const auto result = drive_backend_->take_mode_result();
      if (!result) continue;
      if (*result) drive_mode_ = pending->second.value;
      else {
        if (!drive_backend_->confirmed_mode_valid()) drive_mode_.clear();
        rejected_modes_[subsystem] = pending->second.value;
        rejection_clear_[subsystem] = now + std::chrono::milliseconds(500);
      }
      pending_modes_.erase(pending); publish_fma();
    } else {
      const auto result = arm_backend_->take_mode_result();
      if (!result) continue;
      if (*result) arm_mode_ = pending->second.value;
      else {
        if (!arm_backend_->confirmed_mode_valid()) arm_mode_.clear();
        rejected_modes_[subsystem] = pending->second.value;
        rejection_clear_[subsystem] = now + std::chrono::milliseconds(500);
      }
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
  arm_backend_->tick();
  if (!arm_mode_.empty() && !arm_backend_->confirmed_mode_valid()) {
    arm_mode_.clear();
    publish_fma();
  }
  if (std::chrono::duration<double>(now - last_fma_).count() >= 1.0) publish_fma();
}

void RoverNode::publish_fma()
{
  telemetry_interfaces::msg::FmaState message;
  message.schema = "dcr/fma-state/v1"; message.sequence = ++sequence_; message.law = law_; message.system = "GOOD";
  message.drive = mode_state("drive", drive_mode_); message.arm = mode_state("arm", arm_mode_);
  message.arm_override.state = override_state_; message.arm_override.pending = pending_override_ ? pending_override_->value : "";
  message.gimbal_priority.confirmed = gimbal_priority_; message.gimbal_priority.pending = pending_gimbal_ ? pending_gimbal_->value : "";
  message.gimbal_priority.rejected = "";
  fma_publisher_->publish(message); last_fma_ = std::chrono::steady_clock::now();
}
telemetry_interfaces::msg::FmaModeState RoverNode::mode_state(const std::string & subsystem, const std::string & confirmed) const
{
  telemetry_interfaces::msg::FmaModeState state;
  state.confirmed = confirmed;
  const auto pending = pending_modes_.find(subsystem); state.pending = pending == pending_modes_.end() ? "" : pending->second.value;
  const auto rejected = rejected_modes_.find(subsystem); state.rejected = rejected == rejected_modes_.end() ? "" : rejected->second;
  return state;
}
}  // namespace rover
