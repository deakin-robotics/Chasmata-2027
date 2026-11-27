#pragma once

#include <chrono>
#include <optional>

#include "rover/drive_backend.hpp"
#include "drive_input_mapper.hpp"
#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/float64_multi_array.hpp>

namespace rover
{
class MockDriveBackend final : public DriveBackend
{
public:
  MockDriveBackend(rclcpp::Node & node, double delay_seconds, double max_wheel_speed);
  void request_mode(const std::string & mode) override;
  void cancel_mode_request() override;
  std::optional<bool> take_mode_result() override;
  void on_joy(const sensor_msgs::msg::Joy & joy) override;

private:
  std::chrono::steady_clock::duration delay_;
  double max_wheel_speed_;
  std::string requested_mode_, active_mode_;
  DriveInputMapper input_mapper_;
  rclcpp::Publisher<std_msgs::msg::Float64MultiArray>::SharedPtr commands_;
  std::optional<std::chrono::steady_clock::time_point> due_;
};
}  // namespace rover
