#ifndef ROVER_DRIVETRAIN_CONTROL__DRIVETRAIN_CORE_HPP_
#define ROVER_DRIVETRAIN_CONTROL__DRIVETRAIN_CORE_HPP_

#include <array>
#include <cstdint>
#include <string>

namespace rover_drivetrain_control::core
{

// Independent of ROS, libmodbus and physical controllers, so it is unit-testable without hardware.
struct TimingConfig
{
  double update_hz{0.0};               // required; target 15 Hz
  double upstream_timeout_ms{0.0};     // required; owned upstream
  double stop_deadline_ms{0.0};        // required; team target 300 ms
  double stop_wire_budget_ms{0.0};     // required; MEASURE on bench
  double worst_bus_cycle_ms{0.0};      // required; MEASURE on bench
  double late_trigger_ms{0.0};         // required; no safety default
};

struct ValidationResult
{
  bool ok{false};
  std::string reason;
};

// Checks bounds but is not a substitute for measuring bus timing in hardware.
[[nodiscard]] ValidationResult validateTiming(const TimingConfig & config);

struct MotorSetpoint
{
  double rpm{0.0};             // motor shaft, not a Modbus raw register
  std::uint8_t direction{0};   // semantic 0=stop, 1=forward, 2=reverse
};

// Converts physical wheel rad/s to motor RPM. Does NOT invent register scaling.
[[nodiscard]] ValidationResult translateWheelSpeed(
  double wheel_rad_s, double gear_ratio, bool mirror, double rpm_limit,
  MotorSetpoint & output);

struct WheelCycleHealth
{
  static constexpr std::uint32_t INVALID_AFTER_MISSED_CYCLES = 2;  // data invalid after two missed cycles
  static constexpr std::uint32_t LOST_AFTER_MISSED_CYCLES = 3;     // drive lost after three missed cycles

  std::uint32_t missed_cycles{0};
  bool valid{false};
  bool lost{false};

  // One call PER EXPECTED CYCLE, not once per Modbus transaction.
  void finishCycle(bool all_mandatory_exchanges_succeeded) noexcept;
};

struct BusCycleHealth
{
  bool both_wheels_missed{false};
  bool adapter_failure_observed{false};
  // Correlation alone is not proof of an adapter fault.
  [[nodiscard]] bool confirmed_bus_failure() const noexcept
  {
    return adapter_failure_observed;
  }
};

// The caller supplies times from its own steady_clock; no clock is trusted
// merely because its last stored timestamp looked healthy.
[[nodiscard]] bool lateTrigger(
  std::int64_t previous_tick_ns, std::int64_t current_tick_ns,
  double allowed_gap_ms) noexcept;

// Direct drive; matches diff_drive_controller cmd_vel_timeout (0.11 s).
inline constexpr std::int64_t DIRECT_DRIVE_COMMAND_TIMEOUT_NS = 110'000'000;

// A direct-drive command is fresh only while strictly younger than the timeout.
// Never received (<= 0), stamped after now (clock went backwards) and a
// non-positive timeout all count as stale, so the relay sends zeros.
[[nodiscard]] bool directCommandFresh(
  std::int64_t last_command_ns, std::int64_t now_ns,
  std::int64_t timeout_ns) noexcept;

}  // namespace rover_drivetrain_control::core
#endif
