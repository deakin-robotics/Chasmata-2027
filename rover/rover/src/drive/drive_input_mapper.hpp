#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <optional>
#include <string>
#include <sensor_msgs/msg/joy.hpp>

namespace rover {
// Shared Rover Control input interpretation for real and simulated drivetrains.
class DriveInputMapper {
public:
  std::optional<std::array<double, 4>> map(const std::string & mode, const sensor_msgs::msg::Joy & joy, double limit) {
    release_stop_ = false;
    if (mode == "VELOCITY") {
      if (joy.axes.size() < 2 || !std::isfinite(joy.axes[0]) || !std::isfinite(joy.axes[1]) ||
          std::abs(joy.axes[0]) > 1 || std::abs(joy.axes[1]) > 1) return std::nullopt;
      const double forward = -joy.axes[1], turn = -joy.axes[0];
      const double scale = std::max(1.0, std::abs(forward) + std::abs(turn));
      const double left = limit * (forward - turn) / scale;
      const double right = limit * (forward + turn) / scale;
      return std::array<double, 4>{left, left, right, right};
    }
    if (mode != "MANUAL" || joy.axes.size() <= 5 ||
        !std::isfinite(joy.axes[4]) || !std::isfinite(joy.axes[5]) ||
        joy.axes[4] < 0 || joy.axes[4] > 1 || joy.axes[5] < 0 || joy.axes[5] > 1) return std::nullopt;
    const double left = joy.axes[4], right = joy.axes[5];
    const bool pressed = joy.buttons.size() > 3 && joy.buttons[3] == 1;
    if (pressed && !y_pressed_) {
      reverse_ = !reverse_;
      if (left > 0.0 || right > 0.0) wait_for_release_ = true;
    }
    y_pressed_ = pressed;
    if (wait_for_release_) {
      release_stop_ = true;
      if (left == 0.0 && right == 0.0) wait_for_release_ = false;
      return std::array<double, 4>{0, 0, 0, 0};
    }
    const double direction = reverse_ ? -1.0 : 1.0;
    return std::array<double, 4>{direction * left * limit, direction * left * limit,
      direction * right * limit, direction * right * limit};
  }
  bool releaseStop() const { return release_stop_; }
private:
  bool reverse_{false}, y_pressed_{false}, wait_for_release_{false}, release_stop_{false};
};
}
