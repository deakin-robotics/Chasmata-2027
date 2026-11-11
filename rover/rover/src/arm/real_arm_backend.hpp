#pragma once

#include <array>
#include <chrono>
#include <optional>
#include <string>
#include <vector>
#include <rclcpp/rclcpp.hpp>
#include <sensor_msgs/msg/joy.hpp>
#include <dcr_arm_driver/msg/direct_drive.hpp>
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
  void tick() override;
private:
  using Clock = std::chrono::steady_clock;
  using Status = telemetry_interfaces::msg::ArmControlStatus;
  void on_status(const Status & status);
  void on_joy(const sensor_msgs::msg::Joy & joy);
  void send(bool neutral);
  bool ready() const;
  void fail();
  rclcpp::Publisher<dcr_arm_driver::msg::DirectDrive>::SharedPtr command_;
  rclcpp::Subscription<Status>::SharedPtr status_sub_;
  rclcpp::Subscription<sensor_msgs::msg::Joy>::SharedPtr joy_sub_;
  rclcpp::TimerBase::SharedPtr timer_;
  std::array<double, 6> speeds_{};
  std::array<double, 6> axes_{};
  Status status_;
  Clock::time_point status_time_{}, joy_time_{}, deadline_{};
  uint64_t request_id_{0};
  bool pending_{false}, valid_{false}, sending_{false};
  std::optional<bool> result_;
};
}
