#pragma once

#include <cmath>
#include <chrono>
#include <limits>
#include <optional>
#include <stdexcept>
#include "dcr_arm_driver/motor.hpp"
#include "rclcpp/rclcpp.hpp"
#include "std_msgs/msg/float64.hpp"
#include "std_srvs/srv/trigger.hpp"

namespace dcr_arm_driver {

// Deliberately independent of the arm hardware interface and its interlocks.
class SingleMotorBench : public rclcpp::Node {
public:
  explicit SingleMotorBench(
      const rclcpp::NodeOptions &options = rclcpp::NodeOptions())
      : Node("single_motor_bench", options) {
    const auto id = declare_parameter<int>("motor_id", 5);
    if (id < 1 || id > 0x7FE || id == 0xFF) {
      throw std::invalid_argument("motor_id must be a unicast standard CAN ID");
    }
    motor_id_ = static_cast<uint32_t>(id);
    shortest_path_ = declare_parameter<bool>("shortest_path", true);
    tx_ = create_publisher<can_msgs::msg::Frame>("/arm/bench/tx", 10);
    position_ = create_publisher<std_msgs::msg::Float64>("/arm/bench/position_deg", 10);
    feedback_ = create_subscription<can_msgs::msg::Frame>(
        "/arm/bench/rx", 10, [this](const can_msgs::msg::Frame &frame) {
          if (frame.id != motor_id_ || frame.is_error || frame.is_rtr ||
              frame.is_extended || frame.dlc != 7 || frame.data[0] != 0xA3)
            return;
          const uint32_t bits = uint32_t(frame.data[3]) |
              (uint32_t(frame.data[4]) << 8) | (uint32_t(frame.data[5]) << 16) |
              (uint32_t(frame.data[6]) << 24);
          const int64_t current = bits & 0x80000000U ? int64_t(bits) - 0x100000000LL : bits;
          std_msgs::msg::Float64 position;
          position.data = current * 360.0 / 16384.0;
          position_->publish(position);
          if (!pending_goal_)
            return;
          const double goal = *pending_goal_;
          pending_goal_.reset();
          if (std::chrono::steady_clock::now() - requested_at_ > std::chrono::seconds(1)) {
            RCLCPP_ERROR(get_logger(), "Position reply timed out; send the goal again");
            return;
          }
          // Choose the equivalent target on the closest turn, not turn zero.
          const auto delta = static_cast<int64_t>(std::round(
              std::remainder(goal - position.data, 360.0) * 16384.0 / 360.0));
          const int64_t target = current + delta;
          if (target < std::numeric_limits<int32_t>::min() ||
              target > std::numeric_limits<int32_t>::max()) {
            RCLCPP_ERROR(get_logger(), "Nearest target exceeds the motor count range");
            return;
          }
          can_msgs::msg::Frame command;
          command.id = motor_id_;
          command.dlc = 5;
          command.data[0] = 0xC2;
          const uint32_t encoded = static_cast<uint32_t>(target);
          for (unsigned b = 0; b < 4; ++b)
            command.data[b + 1] = (encoded >> (8 * b)) & 0xFF;
          RCLCPP_INFO(get_logger(), "Current %.2f deg, goal %.2f deg: move %.2f deg",
              position.data, goal, delta * 360.0 / 16384.0);
          publish(command);
        });
    poll_ = create_wall_timer(std::chrono::milliseconds(200), [this] {
      if (pending_goal_ && std::chrono::steady_clock::now() - requested_at_ >
          std::chrono::seconds(1)) {
        pending_goal_.reset();
        RCLCPP_ERROR(get_logger(), "No position reply; goal cancelled, send it again");
      }
      request_position();
    });
    goal_ = create_subscription<std_msgs::msg::Float64>(
        "/arm/bench/angle_deg", 10,
        [this](const std_msgs::msg::Float64 &goal) {
          // Match Motor's float arithmetic before its signed integer cast.
          const float angle = static_cast<float>(goal.data);
          const double counts = angle / 360.0f * 16384.0f;
          if (!std::isfinite(goal.data) || !std::isfinite(counts) ||
              counts < std::numeric_limits<int32_t>::min() ||
              counts > std::numeric_limits<int32_t>::max()) {
            RCLCPP_ERROR(get_logger(), "Angle is not representable by the motor protocol");
            return;
          }
          if (shortest_path_) {
            pending_goal_ = goal.data;
            requested_at_ = std::chrono::steady_clock::now();
            request_position();
          } else {
            publish(motor_.position_control(motor_id_, angle));
          }
        });
    stop_ = create_service<std_srvs::srv::Trigger>(
        "/arm/bench/stop",
        [this](const std_srvs::srv::Trigger::Request::SharedPtr,
               std_srvs::srv::Trigger::Response::SharedPtr response) {
          pending_goal_.reset();
          publish(motor_.speed_control(motor_id_, 0));
          response->success = true;
          response->message = "Zero-speed request sent (not a motor acknowledgement)";
        });
    RCLCPP_WARN(get_logger(),
        "BENCH BYPASS: motor 0x%02X; no host E-stop, feedback gate, rearm, "
        "joint limits, rate limit or motion-command timeout. Goals are degrees.",
        motor_id_);
  }

private:
  void request_position() {
    can_msgs::msg::Frame frame;
    frame.id = motor_id_;
    frame.dlc = 1;
    frame.data[0] = 0xA3;
    publish(frame);
  }
  void publish(can_msgs::msg::Frame frame) {
    frame.header.stamp = now();
    tx_->publish(frame);
  }
  uint32_t motor_id_;
  Motor motor_;
  bool shortest_path_;
  std::optional<double> pending_goal_;
  std::chrono::steady_clock::time_point requested_at_;
  rclcpp::Publisher<std_msgs::msg::Float64>::SharedPtr position_;
  rclcpp::Subscription<can_msgs::msg::Frame>::SharedPtr feedback_;
  rclcpp::TimerBase::SharedPtr poll_;
  rclcpp::Publisher<can_msgs::msg::Frame>::SharedPtr tx_;
  rclcpp::Subscription<std_msgs::msg::Float64>::SharedPtr goal_;
  rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr stop_;
};
}  // namespace dcr_arm_driver
