#include "mock_drive_backend.hpp"

namespace rover
{
MockDriveBackend::MockDriveBackend(double delay_seconds)
: delay_(std::chrono::duration_cast<std::chrono::steady_clock::duration>(
    std::chrono::duration<double>(delay_seconds))) {}

void MockDriveBackend::request_mode(const std::string &)
{
  due_ = std::chrono::steady_clock::now() + delay_;
}

void MockDriveBackend::cancel_mode_request() { due_.reset(); }

std::optional<bool> MockDriveBackend::take_mode_result()
{
  if (!due_ || std::chrono::steady_clock::now() < *due_) return std::nullopt;
  due_.reset();
  return true;
}

void MockDriveBackend::on_joy(const sensor_msgs::msg::Joy &) {}
}  // namespace rover
