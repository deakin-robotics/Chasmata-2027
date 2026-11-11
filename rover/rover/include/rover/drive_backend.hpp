#pragma once

#include <optional>
#include <string>

#include <sensor_msgs/msg/joy.hpp>

namespace rover
{
// Called by the rover executor. A new request replaces any outstanding request.
class DriveBackend
{
public:
  virtual ~DriveBackend() = default;
  virtual void request_mode(const std::string & mode) = 0;
  virtual void cancel_mode_request() = 0;
  // Returns no value while pending, true on success, or false on failure, once.
  virtual std::optional<bool> take_mode_result() = 0;
  // False when a failed handoff leaves controller ownership unknown.
  virtual bool confirmed_mode_valid() const { return true; }
  virtual void on_joy(const sensor_msgs::msg::Joy & joy) = 0;
};
}  // namespace rover
