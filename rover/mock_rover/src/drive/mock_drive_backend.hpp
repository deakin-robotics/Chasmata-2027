#pragma once

#include <chrono>
#include <optional>

#include "mock_rover/drive_backend.hpp"

namespace mock_rover
{
class MockDriveBackend final : public DriveBackend
{
public:
  explicit MockDriveBackend(double delay_seconds);
  void request_mode(const std::string & mode) override;
  void cancel_mode_request() override;
  std::optional<bool> take_mode_result() override;
  void on_joy(const sensor_msgs::msg::Joy & joy) override;

private:
  std::chrono::steady_clock::duration delay_;
  std::optional<std::chrono::steady_clock::time_point> due_;
};
}  // namespace mock_rover
