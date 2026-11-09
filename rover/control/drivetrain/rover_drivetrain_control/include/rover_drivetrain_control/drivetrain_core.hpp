#ifndef ROVER_DRIVETRAIN_CONTROL__DRIVETRAIN_CORE_HPP_
#define ROVER_DRIVETRAIN_CONTROL__DRIVETRAIN_CORE_HPP_

#include <array>
#include <cstddef>
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
  bool all_wheels_missed{false};
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

// --- Bench motion (opt-in, bench_motion_enabled) ---------------------------

// Motor RPM below this is a stop: it would round to raw 0 in register 0x0056.
inline constexpr double BENCH_DEADBAND_MOTOR_RPM = 1.0;
// bench_rpm_cap above this is refused.
inline constexpr double BENCH_MAX_RPM_CAP = 500.0;

struct BenchMotorCommand
{
  std::uint8_t direction{0};  // 0x0066 value: 0 stop, 1 forward, 2 reverse
  std::uint16_t raw_rpm{0};   // 0x0056 value; motor RPM per the manual example, 0 when stopped
  bool clamped{false};
};

// Motor RPM = |wheel rad/s| x 60/(2 pi) x gear_ratio, clamped to rpm_cap.
// Direction comes from the sign, flipped when mirrored. Non-finite input,
// a bad gear ratio or cap, or anything inside the deadband is a stop.
[[nodiscard]] BenchMotorCommand benchMotorCommand(
  double wheel_rad_s, double gear_ratio, bool mirrored, double rpm_cap) noexcept;

// Wheel rad/s from a raw 0x005F read. The drive reports magnitude only, so the
// sign comes from the last direction written (1 forward, 2 reverse), then mirroring.
// Assumes 0x0116 holds the real motor pole pairs, so the manual's
// pole-pair correction factor is 1.
[[nodiscard]] double benchWheelSpeedFromRaw(
  std::uint16_t raw_rpm, double gear_ratio, bool mirrored, std::uint8_t direction) noexcept;

// What this side last wrote to one drive. Unknown means "not acknowledged".
struct BenchOutputState
{
  bool direction_known{false};
  std::uint8_t direction{0};
  std::int64_t direction_sent_ns{0};
  bool speed_known{false};
  std::uint16_t speed{0};
  std::int64_t speed_sent_ns{0};
};

enum class BenchRegister : std::uint8_t { NONE = 0, CONTROL, SPEED };

struct BenchWrite
{
  BenchRegister reg{BenchRegister::NONE};
  std::uint16_t value{0};
};

// At most ONE write per drive per cycle (bus budget). In priority order:
// 1. a stop target, unknown direction or reversal writes stop (0x0066=0) first;
// 2. from stop, speed is written before direction, so a drive never starts at a stale speed;
// 3. a register not sent for resend_after_ns is re-sent (older first);
// 4. otherwise only a changed speed is written.
[[nodiscard]] BenchWrite planBenchWrite(
  const BenchOutputState & state, const BenchMotorCommand & target,
  std::int64_t now_ns, std::int64_t resend_after_ns) noexcept;

// Records a write result: an ACK updates the state, anything else makes it unknown.
void recordBenchWrite(
  BenchOutputState & state, const BenchWrite & write, bool acknowledged,
  std::int64_t now_ns) noexcept;

// Fault-register freshness, per drive and separate from the cycle health:
// reads alternate, so a good actual-speed read on the next cycle resets the
// miss counter and would otherwise hide fault polls that keep failing.
inline constexpr std::uint64_t BENCH_FAULT_POLL_EVERY_CYCLES = 2;
inline constexpr std::uint32_t BENCH_MAX_FAILED_FAULT_POLLS = 2;
// Longest gap without a good fault read, in fault-poll intervals: 2.5 s at 2 Hz.
inline constexpr double BENCH_FAULT_STALE_POLL_INTERVALS = 2.5;

struct FaultFreshness
{
  std::uint32_t consecutive_failed_polls{0};
  std::int64_t last_ok_ns{0};
};

// Fresh start: no failed polls, counted as confirmed at now_ns.
void resetFaultFreshness(FaultFreshness & freshness, std::int64_t now_ns) noexcept;
void recordFaultPoll(FaultFreshness & freshness, bool succeeded, std::int64_t now_ns) noexcept;
// Derived from the rate: 2.5 poll intervals of 2 cycles each. 0 for an invalid rate.
[[nodiscard]] std::int64_t benchFaultStaleAfterNs(double update_hz) noexcept;
// True after BENCH_MAX_FAILED_FAULT_POLLS failed polls in a row, or when the
// last good fault read is older than stale_after_ns.
[[nodiscard]] bool faultPollsStale(
  const FaultFreshness & freshness, std::int64_t now_ns, std::int64_t stale_after_ns) noexcept;

// Modbus RTU wire time, used to refuse "measured" budgets that are physically
// impossible. Floors exclude drive turnaround and USB adapter latency.
struct RtuFraming
{
  int baud_rate{0};
  int data_bits{0};
  bool parity{false};
  int stop_bits{0};
};

[[nodiscard]] double rtuCharMs(const RtuFraming & framing) noexcept;
// Inter-frame silence: 3.5 characters, fixed at 1.75 ms above 19200 baud.
[[nodiscard]] double rtuSilenceMs(const RtuFraming & framing) noexcept;
// Worst bench cycle: one FC03 read and one FC06 write per drive.
[[nodiscard]] double benchWorstCycleFloorMs(const RtuFraming & framing, std::size_t drives) noexcept;
// One stop attempt: broadcast, libmodbus' wait for a reply that never comes,
// then one FC03 status read per drive.
[[nodiscard]] double benchStopFloorMs(
  const RtuFraming & framing, std::size_t drives, double response_timeout_ms) noexcept;

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
