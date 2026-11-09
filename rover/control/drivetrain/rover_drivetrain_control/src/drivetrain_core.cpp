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

namespace
{
constexpr double PI = 3.14159265358979323846;
constexpr double RAD_S_TO_RPM = 60.0 / (2.0 * PI);
}  // namespace

BenchMotorCommand benchMotorCommand(
  double wheel_rad_s, double gear_ratio, bool mirrored, double rpm_cap) noexcept
{
  BenchMotorCommand out{};  // stop
  if (!std::isfinite(wheel_rad_s) || !std::isfinite(gear_ratio) || gear_ratio <= 0.0 ||
      !std::isfinite(rpm_cap) || rpm_cap <= 0.0) {
    return out;
  }
  const double signed_rpm = wheel_rad_s * RAD_S_TO_RPM * gear_ratio * (mirrored ? -1.0 : 1.0);
  double magnitude = std::abs(signed_rpm);
  if (!std::isfinite(magnitude) || magnitude < BENCH_DEADBAND_MOTOR_RPM) {
    return out;
  }
  if (magnitude > rpm_cap) {
    magnitude = rpm_cap;
    out.clamped = true;
  }
  const long raw = std::lround(magnitude);
  if (raw <= 0) {
    return BenchMotorCommand{};
  }
  out.raw_rpm = static_cast<std::uint16_t>(raw);
  out.direction = signed_rpm > 0.0 ? 1 : 2;
  return out;
}

double benchWheelSpeedFromRaw(
  std::uint16_t raw_rpm, double gear_ratio, bool mirrored, std::uint8_t direction) noexcept
{
  if (!std::isfinite(gear_ratio) || gear_ratio <= 0.0) {
    return std::numeric_limits<double>::quiet_NaN();
  }
  const double motor_signed = static_cast<double>(raw_rpm) * (direction == 2 ? -1.0 : 1.0);
  return motor_signed / RAD_S_TO_RPM / gear_ratio * (mirrored ? -1.0 : 1.0);
}

BenchWrite planBenchWrite(
  const BenchOutputState & s, const BenchMotorCommand & target,
  std::int64_t now_ns, std::int64_t resend_after_ns) noexcept
{
  const BenchWrite stop{BenchRegister::CONTROL, 0};
  const auto due = [&](bool known, std::int64_t sent_ns) {
      return !known || now_ns - sent_ns >= resend_after_ns;
    };

  if (target.direction == 0) {
    if (!s.direction_known || s.direction != 0 || due(true, s.direction_sent_ns)) {
      return stop;
    }
    return {};
  }
  // Unknown or opposite direction: stop first, then restart from stop.
  if (!s.direction_known || (s.direction != 0 && s.direction != target.direction)) {
    return stop;
  }
  const bool speed_changed = !s.speed_known || s.speed != target.raw_rpm;
  if (s.direction == 0) {
    if (speed_changed) return {BenchRegister::SPEED, target.raw_rpm};
    return {BenchRegister::CONTROL, target.direction};
  }
  // Moving in the target direction.
  const bool direction_due = due(true, s.direction_sent_ns);
  const bool speed_due = due(s.speed_known, s.speed_sent_ns);
  if (direction_due && (!speed_due || s.direction_sent_ns <= s.speed_sent_ns)) {
    return {BenchRegister::CONTROL, s.direction};
  }
  if (speed_changed || speed_due) {
    return {BenchRegister::SPEED, target.raw_rpm};
  }
  return {};
}

void recordBenchWrite(
  BenchOutputState & s, const BenchWrite & w, bool acknowledged, std::int64_t now_ns) noexcept
{
  if (w.reg == BenchRegister::CONTROL) {
    s.direction_known = acknowledged;
    s.direction = acknowledged ? static_cast<std::uint8_t>(w.value) : 0;
    s.direction_sent_ns = acknowledged ? now_ns : 0;
  } else if (w.reg == BenchRegister::SPEED) {
    s.speed_known = acknowledged;
    s.speed = acknowledged ? w.value : 0;
    s.speed_sent_ns = acknowledged ? now_ns : 0;
  }
}

void resetFaultFreshness(FaultFreshness & freshness, std::int64_t now_ns) noexcept
{
  freshness.consecutive_failed_polls = 0;
  freshness.last_ok_ns = now_ns;
}

void recordFaultPoll(FaultFreshness & freshness, bool succeeded, std::int64_t now_ns) noexcept
{
  if (succeeded) {
    resetFaultFreshness(freshness, now_ns);
  } else if (freshness.consecutive_failed_polls < std::numeric_limits<std::uint32_t>::max()) {
    ++freshness.consecutive_failed_polls;
  }
}

std::int64_t benchFaultStaleAfterNs(double update_hz) noexcept
{
  if (!std::isfinite(update_hz) || update_hz <= 0.0) {
    return 0;  // fail closed: everything is stale
  }
  const double poll_interval_ns =
    static_cast<double>(BENCH_FAULT_POLL_EVERY_CYCLES) * 1e9 / update_hz;
  return static_cast<std::int64_t>(std::llround(BENCH_FAULT_STALE_POLL_INTERVALS * poll_interval_ns));
}

bool faultPollsStale(
  const FaultFreshness & freshness, std::int64_t now_ns, std::int64_t stale_after_ns) noexcept
{
  return freshness.consecutive_failed_polls >= BENCH_MAX_FAILED_FAULT_POLLS ||
         now_ns - freshness.last_ok_ns > stale_after_ns;
}

double rtuCharMs(const RtuFraming & f) noexcept
{
  if (f.baud_rate <= 0) return std::numeric_limits<double>::infinity();
  const int bits = 1 + f.data_bits + (f.parity ? 1 : 0) + f.stop_bits;
  return 1000.0 * bits / f.baud_rate;
}

double rtuSilenceMs(const RtuFraming & f) noexcept
{
  return f.baud_rate > 19200 ? 1.75 : 3.5 * rtuCharMs(f);
}

namespace
{
// FC03 one register: 8-byte request, 7-byte reply. FC06: 8-byte request, 8-byte echo.
constexpr int READ_CHARS = 8 + 7;
constexpr int WRITE_CHARS = 8 + 8;
constexpr int BROADCAST_CHARS = 8;

double exchangeMs(const RtuFraming & f, int chars) noexcept
{
  return chars * rtuCharMs(f) + 2.0 * rtuSilenceMs(f);
}
}  // namespace

double benchWorstCycleFloorMs(const RtuFraming & f, std::size_t drives) noexcept
{
  return static_cast<double>(drives) * (exchangeMs(f, READ_CHARS) + exchangeMs(f, WRITE_CHARS));
}

double benchStopFloorMs(
  const RtuFraming & f, std::size_t drives, double response_timeout_ms) noexcept
{
  return BROADCAST_CHARS * rtuCharMs(f) + rtuSilenceMs(f) + response_timeout_ms +
         static_cast<double>(drives) * exchangeMs(f, READ_CHARS);
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
