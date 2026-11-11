#pragma once

#include <optional>
#include <string>

namespace rover
{
class ArmBackend
{
public:
  virtual ~ArmBackend() = default;
  virtual void request_mode(const std::string & mode) = 0;
  virtual void cancel_mode_request() = 0;
  virtual std::optional<bool> take_mode_result() = 0;
  virtual void tick() = 0;
};
}  // namespace rover
