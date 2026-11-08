#pragma once

#include <array>
#include <cstdint>

#include "rover_drivetrain_control/bld305s_driver.hpp"

namespace rover_drivetrain_control
{
// All transactions share the driver's single RS485 connection.
class DriveCycle
{
public:
  struct Wheel { std::uint8_t id; double gear_ratio; double rpm_limit; bool mirrored; };
  using Wheels = std::array<Wheel, 4>;
  using Values = std::array<double, 4>;
  DriveCycle(Bld305sDriver & driver, Wheels wheels);
  bool initialize();
  bool update(const Values & commands, Values & measured);
  bool brakeAll();

private:
  Bld305sDriver & driver_;
  Wheels wheels_;
  std::array<std::uint16_t, 4> last_direction_{};
  std::array<std::uint16_t, 4> last_motion_direction_{};
};
}  // namespace rover_drivetrain_control
