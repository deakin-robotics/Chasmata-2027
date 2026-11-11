#pragma once
#include "rover/arm_backend.hpp"

namespace rover
{
class RealArmBackend final : public ArmBackend
{
public:
  void request_mode(const std::string &) override { pending_ = true; }
  void cancel_mode_request() override { pending_ = false; }
  std::optional<bool> take_mode_result() override {
    if (!pending_) return std::nullopt;
    pending_ = false;
    return false;
  }
  void tick() override {}
private:
  bool pending_{false};
};
}  // namespace rover
