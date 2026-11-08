#include "rover_drivetrain_control/drive_cycle.hpp"

#include <cmath>
#include <limits>

#include "rover_drivetrain_control/drivetrain_core.hpp"

namespace rover_drivetrain_control
{
namespace { constexpr double kPi = 3.14159265358979323846; }

DriveCycle::DriveCycle(Bld305sDriver & driver, Wheels wheels)
: driver_(driver), wheels_(wheels) {}

bool DriveCycle::brakeAll()
{
  bool ok = true;
  for (std::size_t i = 0; i < wheels_.size(); ++i) {
    if (!driver_.writeControlRaw(wheels_[i].id, 3)) ok = false;
    last_direction_[i] = 0;
  }
  return ok;
}

bool DriveCycle::initialize()
{
  for (const auto & wheel : wheels_) {
    std::uint16_t fault = 0, status = 0;
    if (!driver_.writeControlRaw(wheel.id, 3) || !driver_.setInternalMode(wheel.id) ||
      !driver_.writeControlRaw(wheel.id, 3) ||
      !driver_.readControlRaw(wheel.id, status) || status != 3 ||
      !driver_.readFaultRaw(wheel.id, fault) || fault != 0) {
      brakeAll();
      return false;
    }
  }
  last_direction_.fill(0);
  return true;
}

bool DriveCycle::update(const Values & commands, Values & measured)
{
  Bld305sDriver::SlaveIds ids{};
  std::array<core::MotorSetpoint, 4> targets{};
  for (std::size_t i = 0; i < wheels_.size(); ++i) ids[i] = wheels_[i].id;
  for (std::size_t i = 0; i < wheels_.size(); ++i) {
    const auto & wheel = wheels_[i];
    if (!core::translateWheelSpeed(commands[i], wheel.gear_ratio, wheel.mirrored, wheel.rpm_limit, targets[i]).ok ||
      targets[i].rpm > 4000.0) {
      brakeAll();
      measured.fill(std::numeric_limits<double>::quiet_NaN());
      return false;
    }
  }
  if (!driver_.beginCycle(ids)) return false;
  Values next = measured;
  bool ok = true;
  for (const auto & wheel : wheels_) {
    std::uint16_t fault = 0;
    if (!driver_.readFaultRaw(wheel.id, fault) || fault != 0) ok = false;
  }
  if (!ok) {
    (void)driver_.endCycle();
    brakeAll();
    measured.fill(std::numeric_limits<double>::quiet_NaN());
    return false;
  }
  for (std::size_t i = 0; i < wheels_.size(); ++i) {
    const auto & wheel = wheels_[i];
    const auto & target = targets[i];
    const auto direction = static_cast<std::uint16_t>(target.direction);
    const auto rpm = static_cast<std::uint16_t>(std::lround(target.rpm));
    if (direction == 0 || rpm == 0) {
      if (!driver_.writeControlRaw(wheel.id, 3)) { ok = false; continue; }
      last_direction_[i] = 0;
    } else {
      if (last_direction_[i] != 0 && last_direction_[i] != direction) {
        std::uint16_t stopped = 0;
        if (!driver_.writeControlRaw(wheel.id, 0) || !driver_.readControlRaw(wheel.id, stopped) || stopped != 0) {
          ok = false; continue;
        }
      }
      if (!driver_.writeSpeedRaw(wheel.id, rpm) || !driver_.writeControlRaw(wheel.id, direction)) {
        ok = false; continue;
      }
      last_direction_[i] = direction;
      last_motion_direction_[i] = direction;
    }
    std::uint16_t raw_speed = 0, status = 0;
    if (!driver_.readActualSpeedRaw(wheel.id, raw_speed) ||
      !driver_.readControlRaw(wheel.id, status) || status > 3) {
      ok = false; continue;
    }
    const auto feedback_direction = status == 1 || status == 2 ? status : last_motion_direction_[i];
    const double sign = feedback_direction == 1 ? 1.0 : feedback_direction == 2 ? -1.0 : 0.0;
    if (raw_speed != 0 && sign == 0.0) { ok = false; continue; }
    next[i] = sign * (wheel.mirrored ? -1.0 : 1.0) * raw_speed * 2.0 * kPi / (60.0 * wheel.gear_ratio);
  }
  if (!driver_.endCycle()) ok = false;
  if (!ok) {
    brakeAll();
    measured.fill(std::numeric_limits<double>::quiet_NaN());
    return false;
  }
  measured = next;
  return true;
}
}  // namespace rover_drivetrain_control
