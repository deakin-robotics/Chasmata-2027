#include "mock_drive_backend.hpp"

namespace rover {
MockDriveBackend::MockDriveBackend(rclcpp::Node & node, double delay_seconds, double max_wheel_speed)
: delay_(std::chrono::duration_cast<std::chrono::steady_clock::duration>(std::chrono::duration<double>(delay_seconds))),
  max_wheel_speed_(max_wheel_speed),
  commands_(node.create_publisher<std_msgs::msg::Float64MultiArray>("/mock/drivetrain/wheel_commands", 10)) {}

void MockDriveBackend::request_mode(const std::string & mode) {
  requested_mode_ = mode;
  due_ = std::chrono::steady_clock::now() + delay_;
}
void MockDriveBackend::cancel_mode_request() { due_.reset(); }
std::optional<bool> MockDriveBackend::take_mode_result() {
  if (!due_ || std::chrono::steady_clock::now() < *due_) return std::nullopt;
  due_.reset();
  if (active_mode_ != requested_mode_) {
    std_msgs::msg::Float64MultiArray stop; stop.data.assign(4, 0.0); commands_->publish(stop);
  }
  active_mode_ = requested_mode_;
  return true;
}
void MockDriveBackend::on_joy(const sensor_msgs::msg::Joy & joy) {
  if (active_mode_.empty()) return;
  const auto wheels = input_mapper_.map(active_mode_, joy, max_wheel_speed_);
  std_msgs::msg::Float64MultiArray command;
  if (wheels) command.data.assign(wheels->begin(), wheels->end());
  else command.data.assign(4, 0.0);
  commands_->publish(command);
}
}
