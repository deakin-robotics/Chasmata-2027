#include "rover_drivetrain_control/drivetrain_core.hpp"

#include <cmath>
#include <limits>

namespace rover_drivetrain_control::core
{
ValidationResult validateTiming(const TimingConfig & c)
{
  if (!std::isfinite(c.update_hz) || c.update_hz <= 0.0 ||
      !std::isfinite(c.upstream_timeout_ms) || c.upstream_timeout_ms <= 0.0 ||
      !std::isfinite(c.stop_deadline_ms) || c.stop_deadline_ms <= 0.0 ||
      !std::isfinite(c.stop_wire_budget_ms) || c.stop_wire_budget_ms <= 0.0 ||
      !std::isfinite(c.worst_bus_cycle_ms) || c.worst_bus_cycle_ms <= 0.0 ||
      !std::isfinite(c.late_trigger_ms) || c.late_trigger_ms <= 0.0) {
    return {false, "All safety-relevant timing values and bench budgets must be positive and supplied explicitly"};
  }
  const double period_ms = 1000.0 / c.update_hz;
  if (c.worst_bus_cycle_ms > period_ms * 0.5) {
    return {false, "Worst-case measured bus cycle exceeds the 50% bus utilization limit"};
  }
  // Conservatively allocate two periods to include one missed trigger.
  if (c.upstream_timeout_ms + 2.0 * period_ms + c.stop_wire_budget_ms > c.stop_deadline_ms) {
    return {false, "Upstream timeout + two cycle periods + bench stop budget exceeds stop deadline"};
  }
  if (c.late_trigger_ms > 2.0 * period_ms ||
      c.upstream_timeout_ms + c.late_trigger_ms + c.stop_wire_budget_ms > c.stop_deadline_ms) {
    return {false, "Late-trigger bound is incompatible with the stop deadline and skipped-cycle allowance"};
  }
  if (c.late_trigger_ms < period_ms) {
    return {false, "Late-trigger threshold is shorter than the configured cycle period"};
  }
  return {true, "Timing inputs pass arithmetic checks; bench validation is still required"};
}

ValidationResult translateWheelSpeed(
  double rad_s, double gear_ratio, bool mirror, double rpm_limit,
  MotorSetpoint & output)
{
  if (!std::isfinite(rad_s) || !std::isfinite(gear_ratio) || gear_ratio <= 0.0 ||
      !std::isfinite(rpm_limit) || rpm_limit <= 0.0) {
    return {false, "Invalid wheel command, gearbox ratio or motor RPM limit"};
  }
  constexpr double pi = 3.14159265358979323846;
  const double signed_motor_rpm = rad_s * (60.0 / (2.0 * pi)) * gear_ratio * (mirror ? -1.0 : 1.0);
  if (!std::isfinite(signed_motor_rpm) || std::abs(signed_motor_rpm) > rpm_limit) {
    return {false, "Motor RPM exceeds explicitly configured limit"};
  }
  MotorSetpoint candidate{};
  candidate.rpm = std::abs(signed_motor_rpm);
  candidate.direction = signed_motor_rpm > 0.0 ? 1 : signed_motor_rpm < 0.0 ? 2 : 0;
  output = candidate;
  return {true, "Motor-side RPM calculated; Modbus encoding remains unverified"};
}

void WheelCycleHealth::finishCycle(bool all_ok) noexcept
{
  if (all_ok) {
    missed_cycles = 0;
    valid = true;
    lost = false;
    return;
  }
  if (missed_cycles < std::numeric_limits<std::uint32_t>::max()) {
    ++missed_cycles;
  }
  // A failed cycle may keep previously good data valid (one-cycle grace), never grant it.
  valid = valid && missed_cycles < INVALID_AFTER_MISSED_CYCLES;
  lost = missed_cycles >= LOST_AFTER_MISSED_CYCLES;
}

bool lateTrigger(std::int64_t prev, std::int64_t now, double allowed_ms) noexcept
{
  if (prev <= 0 || now <= prev || !std::isfinite(allowed_ms) || allowed_ms <= 0.0) {
    return false;
  }
  return static_cast<double>(now - prev) > allowed_ms * 1000000.0;
}

bool directCommandFresh(std::int64_t last, std::int64_t now, std::int64_t timeout_ns) noexcept
{
  if (last <= 0 || now < last || timeout_ns <= 0) {
    return false;
  }
  return now - last < timeout_ns;
}

}  // namespace rover_drivetrain_control::core
