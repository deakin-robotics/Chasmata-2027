// Opt-in bench motion for RoverHardwareInterface (bench_motion_enabled=true).
//
// Wheels off the ground, one person holding the power cutoff on the motor
// controllers' supply: that cutoff is the hardware stop. EN is unwired and the
// drives run in internal (Modbus) mode, so nothing here relies on EN.
// Register meanings: docs/BLD305S_REGISTERS.md (manual-cited, not bench-verified).
// Never writes 0x00F6 (baud), 0x00A6 (address) or 0x80FF (save); the driver
// also refuses them.

#include "rover_drivetrain_control/rover_hardware_interface.hpp"

#include <rclcpp/rclcpp.hpp>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <limits>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>

namespace rover_drivetrain_control
{

namespace
{

rclcpp::Logger logger()
{
  return rclcpp::get_logger("rover_drivetrain_control.RoverHardwareInterface");
}

using CallbackReturn = hardware_interface::CallbackReturn;
using ReturnType = hardware_interface::return_type;

std::string describe(const Bld305sDriver::Result & r)
{
  return "driver error " + std::to_string(static_cast<unsigned>(r.code)) +
         ", libmodbus rc " + std::to_string(r.libmodbus_return_code) +
         ", errno " + std::to_string(r.system_errno);
}

}  // namespace

RoverHardwareInterface::~RoverHardwareInterface()
{
  if (!bench_motion_enabled_) {
    return;
  }
  std::lock_guard<std::mutex> lock(bench_mutex_);
  if ((active_ || bench_stop_unconfirmed_) && transport_open_) {
    (void)stopAllAndConfirm("hardware interface destroyed while active or with a stop unaccepted");
  }
}

bool RoverHardwareInterface::parseBenchConfiguration()
{
  const auto & parameters = hardware_info_.hardware_parameters;

  // No defaults: every bench value is a deliberate choice.
  const auto pole_it = parameters.find("pole_pairs");
  const auto cap_it = parameters.find("bench_rpm_cap");
  const auto deadline_it = parameters.find("bench_stop_deadline_ms");
  if (pole_it == parameters.end() || cap_it == parameters.end() ||
      deadline_it == parameters.end()) {
    RCLCPP_ERROR(logger(), "Bench mode requires pole_pairs, bench_rpm_cap and "
      "bench_stop_deadline_ms; none has a default.");
    return false;
  }

  try {
    std::size_t used = 0;
    bench_pole_pairs_ = std::stoll(pole_it->second, &used, 10);
    if (used != pole_it->second.size()) throw std::invalid_argument("pole_pairs");
    used = 0;
    bench_rpm_cap_ = std::stod(cap_it->second, &used);
    if (used != cap_it->second.size()) throw std::invalid_argument("bench_rpm_cap");
    used = 0;
    bench_stop_deadline_ms_ = std::stod(deadline_it->second, &used);
    if (used != deadline_it->second.size()) throw std::invalid_argument("bench_stop_deadline_ms");
  } catch (const std::exception &) {
    RCLCPP_ERROR(logger(), "Bench parameters must be numbers: pole_pairs an integer, "
      "bench_rpm_cap and bench_stop_deadline_ms decimal.");
    return false;
  }

  // Manual write range for 0x0116 is 1..255.
  if (bench_pole_pairs_ < 1 || bench_pole_pairs_ > 255) {
    RCLCPP_ERROR(logger(), "pole_pairs must be 1..255 (from the motor datasheet and the probe).");
    return false;
  }
  if (!std::isfinite(bench_rpm_cap_) || bench_rpm_cap_ <= 0.0 ||
      bench_rpm_cap_ > core::BENCH_MAX_RPM_CAP) {
    RCLCPP_ERROR(logger(), "bench_rpm_cap must be above 0 and at most %.0f motor RPM.",
      core::BENCH_MAX_RPM_CAP);
    return false;
  }
  if (!std::isfinite(bench_stop_deadline_ms_) || bench_stop_deadline_ms_ <= 0.0 ||
      bench_stop_deadline_ms_ > core::BENCH_MAX_STOP_DEADLINE_MS) {
    RCLCPP_ERROR(logger(), "bench_stop_deadline_ms must be above 0 and at most %.0f ms: a stop "
      "blocks the calling thread for up to this long.", core::BENCH_MAX_STOP_DEADLINE_MS);
    return false;
  }

  // rw_rate is an integer attribute, so the bench rate must be a whole number.
  const double hz = timing_.update_hz;
  if (hz < 1.0 || hz > 15.0 || std::abs(hz - std::round(hz)) > 1e-9) {
    RCLCPP_ERROR(logger(), "Bench update_hz must be a whole number from 1 to 15.");
    return false;
  }

  // Refuse "measured" budgets below the bare wire time for this framing.
  const core::RtuFraming framing{bus_config_.baud_rate, bus_config_.data_bits,
    bus_config_.parity != 'N', bus_config_.stop_bits};
  const double cycle_floor = core::benchWorstCycleFloorMs(framing, WHEEL_COUNT);
  const double stop_floor = core::benchStopFloorMs(framing, WHEEL_COUNT,
    static_cast<double>(bus_config_.response_timeout.count()));
  if (timing_.worst_bus_cycle_ms < cycle_floor) {
    RCLCPP_ERROR(logger(), "measured_worst_bus_cycle_ms %.1f is below the %.1f ms wire-time "
      "floor for four drives at %d baud (one read and one write each).",
      timing_.worst_bus_cycle_ms, cycle_floor, bus_config_.baud_rate);
    return false;
  }
  if (timing_.stop_wire_budget_ms < stop_floor) {
    RCLCPP_ERROR(logger(), "measured_stop_wire_budget_ms %.1f is below the %.1f ms floor for "
      "one broadcast stop plus four status reads at %d baud.",
      timing_.stop_wire_budget_ms, stop_floor, bus_config_.baud_rate);
    return false;
  }

  // Re-send each output register at least once a second.
  const auto period_ns = static_cast<std::int64_t>(1e9 / hz);
  bench_resend_after_ns_ = std::max<std::int64_t>(0, 1'000'000'000LL - period_ns);
  bench_poll_stale_after_ns_ = core::benchPollStaleAfterNs(hz);
  return true;
}

void RoverHardwareInterface::endOpenCycle() noexcept
{
  if (bench_cycle_open_ && driver_) {
    (void)driver_->endCycle();
  }
  bench_cycle_open_ = false;
}

std::string RoverHardwareInterface::drivesNotStopped()
{
  std::string not_stopped;
  for (std::size_t w = 0; w < WHEEL_COUNT; ++w) {
    std::uint16_t status = 0xFFFF;
    const auto r = driver_->readRunningStatusRaw(wheels_[w].slave_id, status);
    if (!r || status != 0) {
      not_stopped += " " + wheels_[w].joint_name + "(ID " +
        std::to_string(wheels_[w].slave_id) + (r ? ", status " + std::to_string(status) :
        ", no valid reply") + ")";
    }
  }
  return not_stopped;
}

std::string RoverHardwareInterface::actualSpeedsForLog()
{
  // Shows whether status 0 meant "stopped" or only "accepted": a nonzero
  // value here is a motor still turning after the drive accepted the stop.
  std::string speeds;
  for (std::size_t w = 0; w < WHEEL_COUNT; ++w) {
    std::uint16_t raw = 0;
    const bool ok = static_cast<bool>(driver_->readActualSpeedRaw(wheels_[w].slave_id, raw));
    speeds += " " + wheels_[w].joint_name + "(ID " + std::to_string(wheels_[w].slave_id) +
      ") " + (ok ? std::to_string(raw) : std::string("n/a"));
  }
  return speeds;
}

void RoverHardwareInterface::markStopAccepted(std::size_t wheel) noexcept
{
  core::recordBenchWrite(bench_output_[wheel], {core::BenchRegister::CONTROL, 0}, true,
    steadyNowNs());
  bench_stop_cycle_[wheel] = bench_cycle_index_;
  bench_speed_read_since_stop_[wheel] = false;
  bench_near_zero_since_stop_[wheel] = false;
}

bool RoverHardwareInterface::stopAllAndConfirm(const std::string & reason)
{
  if (!driver_ || !transport_open_) {
    RCLCPP_ERROR(logger(), "STOP (%s): bus not open, cannot command or check a stop. "
      "Use the power cutoff.", reason.c_str());
    bench_stop_unconfirmed_ = true;
    return false;
  }
  endOpenCycle();

  // Status 0 means the drive accepted the stop command. It is not proof the
  // motor has run down; 0x005F shows that (see the README bench test step).
  const std::int64_t deadline = steadyNowNs() +
    static_cast<std::int64_t>(bench_stop_deadline_ms_ * 1e6);
  unsigned attempts = 0;
  std::string not_stopped;
  do {
    ++attempts;
    const auto broadcast = driver_->broadcastStop();
    if (!broadcast) {
      RCLCPP_ERROR(logger(), "STOP (%s): broadcast %u not sent (%s).", reason.c_str(), attempts,
        describe(broadcast).c_str());
    }
    not_stopped = drivesNotStopped();
    if (not_stopped.empty()) {
      for (std::size_t w = 0; w < WHEEL_COUNT; ++w) markStopAccepted(w);
      bench_stop_unconfirmed_ = false;
      const std::string speeds = actualSpeedsForLog();  // after the result is settled
      RCLCPP_WARN(logger(), "STOP (%s): stop accepted (status 0) by all four drives after "
        "%u broadcast(s); 0x005F raw motor RPM just after:%s", reason.c_str(), attempts,
        speeds.c_str());
      return true;
    }
  } while (steadyNowNs() < deadline);

  for (auto & out : bench_output_) {
    out.direction_known = false;  // the next stop always re-sends
  }
  bench_stop_unconfirmed_ = true;
  RCLCPP_ERROR(logger(), "STOP (%s) NOT ACCEPTED within %.0f ms after %u broadcast(s):%s. "
    "Use the power cutoff now.", reason.c_str(), bench_stop_deadline_ms_, attempts,
    not_stopped.c_str());
  return false;
}

bool RoverHardwareInterface::keepBroadcastingStop(const std::string & reason)
{
  if (!driver_ || !transport_open_) {
    return false;
  }
  const std::int64_t end = steadyNowNs() +
    static_cast<std::int64_t>(core::BENCH_UNCONFIRMED_STOP_WINDOW_MS * 1e6);
  const auto pause = std::chrono::nanoseconds(static_cast<std::int64_t>(1e9 / timing_.update_hz));
  unsigned attempts = 0;
  while (steadyNowNs() < end) {
    ++attempts;
    (void)driver_->broadcastStop();
    const std::string not_stopped = drivesNotStopped();
    if (not_stopped.empty()) {
      for (std::size_t w = 0; w < WHEEL_COUNT; ++w) markStopAccepted(w);
      bench_stop_unconfirmed_ = false;
      const std::string speeds = actualSpeedsForLog();
      RCLCPP_WARN(logger(), "STOP (%s): stop accepted (status 0) by all four drives after %u "
        "further broadcast(s); 0x005F raw motor RPM just after:%s", reason.c_str(), attempts,
        speeds.c_str());
      return true;
    }
    RCLCPP_ERROR(logger(), "STOP (%s) still NOT ACCEPTED, broadcast %u of a %.0f s window:%s. "
      "Use the power cutoff.", reason.c_str(), attempts,
      core::BENCH_UNCONFIRMED_STOP_WINDOW_MS / 1000.0, not_stopped.c_str());
    std::this_thread::sleep_for(pause);
  }
  return false;
}

CallbackReturn RoverHardwareInterface::benchConfigure()
{
  std::lock_guard<std::mutex> lock(bench_mutex_);
  bench_configured_ = false;

  // Reads only: every drive must answer at its own address with no fault.
  // A failed, mismatched or garbled reply refuses. Duplicate addresses show up
  // as a garbled reply (drives answering together) or, with exactly four
  // drives, as one of IDs 1..4 not answering.
  for (const auto & wheel : wheels_) {
    std::uint16_t address = 0;
    auto r = driver_->readDriveAddressRaw(wheel.slave_id, address);
    if (!r) {
      RCLCPP_ERROR(logger(), "Bench configure refused: %s (ID %u) gave no valid drive-address "
        "reply (%s). No reply, a garbled reply, or several drives answering at one address.",
        wheel.joint_name.c_str(), static_cast<unsigned>(wheel.slave_id), describe(r).c_str());
      closeDriver();
      return CallbackReturn::ERROR;
    }
    if (address != wheel.slave_id) {
      RCLCPP_ERROR(logger(), "Bench configure refused: %s expects ID %u but the drive reports "
        "address %u (0x00A6).", wheel.joint_name.c_str(),
        static_cast<unsigned>(wheel.slave_id), static_cast<unsigned>(address));
      closeDriver();
      return CallbackReturn::ERROR;
    }
    std::uint16_t fault = 0xFFFF;
    r = driver_->readFaultRaw(wheel.slave_id, fault);
    if (!r) {
      RCLCPP_ERROR(logger(), "Bench configure refused: %s (ID %u) gave no valid fault-code "
        "reply (%s).", wheel.joint_name.c_str(), static_cast<unsigned>(wheel.slave_id),
        describe(r).c_str());
      closeDriver();
      return CallbackReturn::ERROR;
    }
    if (fault != 0) {
      RCLCPP_ERROR(logger(), "Bench configure refused: %s (ID %u) reports fault code %u "
        "(0x0076; see docs/BLD305S_REGISTERS.md).", wheel.joint_name.c_str(),
        static_cast<unsigned>(wheel.slave_id), static_cast<unsigned>(fault));
      closeDriver();
      return CallbackReturn::ERROR;
    }
  }

  bench_configured_ = true;
  RCLCPP_WARN(logger(), "BENCH MODE configured: all four drives answered at their own address "
    "with no fault. Nothing has been written. Motion stays locked until activation.");
  return CallbackReturn::SUCCESS;
}

CallbackReturn RoverHardwareInterface::benchActivate()
{
  std::lock_guard<std::mutex> lock(bench_mutex_);
  active_ = false;
  if (!bench_configured_) {
    RCLCPP_ERROR(logger(), "Refusing bench activation: bench configure has not succeeded.");
    return CallbackReturn::ERROR;
  }

  bench_cycle_index_ = 0;
  bench_output_ = {};
  bench_last_motion_direction_.fill(0);  // none yet: the first start is not a reversal

  // Stop all four first, before any per-drive write, whatever state the
  // drives were left in.
  if (!stopAllAndConfirm("activation: stop before any per-drive write")) {
    RCLCPP_ERROR(logger(), "Bench activation refused: not all four drives accepted the initial "
      "stop. Nothing else was written.");
    bench_stop_latched_ = true;
    return CallbackReturn::ERROR;
  }
  bench_stop_latched_ = false;

  // Per drive: internal mode and pole pairs (never saved), read both back,
  // zero the speed setpoint, then stop and confirm the running status is 0.
  // A successful FC06 write means libmodbus matched the echoed address and value.
  const auto pole_pairs = static_cast<std::uint16_t>(bench_pole_pairs_);
  // Returns an empty string if the drive passed, otherwise the reason it failed.
  auto prepare_drive = [&](const WheelConfig & wheel) -> std::string {
      const auto id = wheel.slave_id;
      std::uint16_t value = 0;
      Bld305sDriver::Result r = driver_->writeControlModeRaw(id, 1);
      if (!r) return "control mode write 0x0136=1 failed (" + describe(r) + ")";
      r = driver_->writePolePairsRaw(id, pole_pairs);
      if (!r) {
        return "pole pairs write 0x0116=" + std::to_string(pole_pairs) + " failed (" +
               describe(r) + ")";
      }
      r = driver_->readControlModeRaw(id, value);
      if (!r) {
        // The manual lists 0x0136 for FC06 only. Exception 2 alone means the drive
        // answered but cannot read it back, so the FC06 echo above is the confirmation.
        // Any other failure (timeout, CRC, other exception) still refuses.
        if (!Bld305sDriver::isIllegalDataAddress(r)) {
          return "control mode read-back failed (" + describe(r) + ")";
        }
        RCLCPP_WARN(logger(), "Bench activation: %s (ID %u) does not support reading back "
          "0x0136 (exception 2, illegal data address); accepting the write echo of 0x0136=1.",
          wheel.joint_name.c_str(), static_cast<unsigned>(id));
      } else if (value != 1) {
        return "control mode read back " + std::to_string(value) + ", expected 1";
      }
      r = driver_->readPolePairsRaw(id, value);
      if (!r) return "pole pairs read-back failed (" + describe(r) + ")";
      if (value != pole_pairs) {
        return "pole pairs read back " + std::to_string(value) + ", expected " +
               std::to_string(pole_pairs);
      }
      // The manual documents no read-back for 0x0056; the write echo confirms it.
      r = driver_->writeSpeedRaw(id, 0);
      if (!r) return "speed write 0x0056=0 failed (" + describe(r) + ")";
      r = driver_->writeControlRaw(id, 0);
      if (!r) return "stop write 0x0066=0 failed (" + describe(r) + ")";
      r = driver_->readRunningStatusRaw(id, value);
      if (!r) return "running status read failed (" + describe(r) + ")";
      if (value != 0) return "running status " + std::to_string(value) + " after stop, expected 0";
      return {};
    };

  for (const auto & wheel : wheels_) {
    const std::string failure = prepare_drive(wheel);
    if (!failure.empty()) {
      RCLCPP_ERROR(logger(), "Bench activation refused: %s (ID %u): %s.",
        wheel.joint_name.c_str(), static_cast<unsigned>(wheel.slave_id), failure.c_str());
      bench_stop_latched_ = true;
      (void)stopAllAndConfirm("activation refused");
      return CallbackReturn::ERROR;
    }
  }

  const auto now = steadyNowNs();
  for (std::size_t w = 0; w < WHEEL_COUNT; ++w) {
    core::recordBenchWrite(bench_output_[w], {core::BenchRegister::SPEED, 0}, true, now);
    markStopAccepted(w);
  }
  // Configure confirmed fault 0 on every drive; freshness starts again from
  // here. Activation just confirmed all four stopped, so export 0, never a
  // velocity from before. Never export NaN while active: diff_drive_controller
  // (4.42.1, closed loop) returns ERROR on NaN feedback before it writes wheel
  // commands, which also skips its cmd_vel-timeout zero.
  for (std::size_t w = 0; w < WHEEL_COUNT; ++w) {
    core::resetPollFreshness(bench_fault_freshness_[w], now);
    core::resetPollFreshness(bench_speed_freshness_[w], now);
    raw_speed_state_valid_[w] = false;
    state_velocity_rad_s_[w] = 0.0;
  }
  previous_read_tick_ns_ = 0;
  late_trigger_detected_ = false;
  read_blocked_logged_.store(false, std::memory_order_release);
  write_blocked_logged_.store(false, std::memory_order_release);
  active_ = true;
  RCLCPP_WARN(logger(), "BENCH MOTION ACTIVE: cap %.0f motor RPM, %.0f Hz, stop deadline %.0f ms. "
    "Wheels off the ground; someone must hold the power cutoff.", bench_rpm_cap_,
    timing_.update_hz, bench_stop_deadline_ms_);
  return CallbackReturn::SUCCESS;
}

CallbackReturn RoverHardwareInterface::benchDeactivate()
{
  std::lock_guard<std::mutex> lock(bench_mutex_);
  if (!active_) {
    return CallbackReturn::SUCCESS;
  }
  bench_stop_latched_ = true;  // no motion commands from here on
  if (!stopAllAndConfirm("deactivate")) {
    // FAILURE keeps the framework's lifecycle state at active, matching active_.
    RCLCPP_ERROR(logger(), "Deactivation failed: not all four drives accepted the stop "
      "(status 0) within %.0f ms. The hardware stays active with motion latched off: read() and "
      "write() send nothing more, so no further stop is sent until deactivation is retried or "
      "on_error runs, which keeps broadcasting stop for %.0f s. Use the power cutoff.",
      bench_stop_deadline_ms_, core::BENCH_UNCONFIRMED_STOP_WINDOW_MS / 1000.0);
    return CallbackReturn::FAILURE;
  }
  active_ = false;
  return CallbackReturn::SUCCESS;
}

CallbackReturn RoverHardwareInterface::benchShutdown(bool from_error)
{
  std::lock_guard<std::mutex> lock(bench_mutex_);
  bench_stop_latched_ = true;
  active_ = false;
  bench_configured_ = false;
  const std::string reason = from_error ? "error" : "shutdown";
  bool accepted = !bench_stop_unconfirmed_;
  if (transport_open_) {
    accepted = stopAllAndConfirm(reason);
    if (!accepted && from_error) {
      accepted = keepBroadcastingStop(reason);
    }
  }
  if (!accepted && from_error) {
    // Keep the bus open: a repeated on_error, a retry or the destructor can
    // still broadcast stop. Every repeat returns FAILURE until a stop is accepted.
    RCLCPP_ERROR(logger(), "on_error: stop still not accepted by all four drives; the bus "
      "stays open. Use the power cutoff.");
    return CallbackReturn::FAILURE;
  }
  closeDriver();
  return accepted ? CallbackReturn::SUCCESS : CallbackReturn::ERROR;
}

ReturnType RoverHardwareInterface::benchSafetyStop(const std::string & reason)
{
  bench_stop_latched_ = true;
  (void)stopAllAndConfirm(reason);
  return ReturnType::ERROR;
}

ReturnType RoverHardwareInterface::benchRead()
{
  std::lock_guard<std::mutex> lock(bench_mutex_);
  if (!active_) {
    return ReturnType::OK;  // inactive: nothing to read, the bus is not touched
  }
  if (bench_stop_latched_) {
    return ReturnType::ERROR;
  }
  if (late_trigger_detected_) {
    return benchSafetyStop("late trigger: cycle gap exceeded late_trigger_ms");
  }

  endOpenCycle();  // write() did not run after the previous read()
  std::array<std::uint8_t, WHEEL_COUNT> ids{};
  for (std::size_t w = 0; w < WHEEL_COUNT; ++w) ids[w] = wheels_[w].slave_id;
  if (!driver_->beginCycle(ids)) {
    return benchSafetyStop("could not start a bus cycle");
  }
  bench_cycle_open_ = true;

  // At 9600 baud there is time for one read per drive per cycle, so actual
  // speed and fault code alternate.
  const bool speed_cycle = bench_cycle_index_ % core::BENCH_POLL_EVERY_CYCLES == 0;
  for (std::size_t w = 0; w < WHEEL_COUNT; ++w) {
    const auto & wheel = wheels_[w];
    std::uint16_t raw = 0;
    if (speed_cycle) {
      const bool ok = static_cast<bool>(driver_->readActualSpeedRaw(wheel.slave_id, raw));
      core::recordPoll(bench_speed_freshness_[w], ok, steadyNowNs());
      if (ok) {
        raw_speed_state_[w] = raw;
        raw_speed_state_valid_[w] = true;
        state_velocity_rad_s_[w] = core::benchWheelSpeedFromRaw(
          raw, wheel.gear_ratio, wheel.mirrored, bench_last_motion_direction_[w]);
        // Reads run before this cycle's writes, so any read in a later cycle
        // than the stop was taken after it.
        if (bench_cycle_index_ > bench_stop_cycle_[w]) {
          bench_speed_read_since_stop_[w] = true;
          if (raw <= core::BENCH_NEAR_ZERO_MOTOR_RPM) bench_near_zero_since_stop_[w] = true;
        }
      } else {
        // Keep exporting the last good value from the previous poll, never NaN
        // (see benchActivate). The next poll either refreshes it or, as a
        // second failure in a row, stops all four below.
        raw_speed_state_valid_[w] = false;
      }
    } else {
      const bool ok = static_cast<bool>(driver_->readFaultRaw(wheel.slave_id, raw));
      core::recordPoll(bench_fault_freshness_[w], ok, steadyNowNs());
      if (ok && raw != 0) {
        return benchSafetyStop(wheel.joint_name + " (ID " + std::to_string(wheel.slave_id) +
          ") fault code " + std::to_string(raw));
      }
    }
  }

  // Checked every cycle, apart from cycle health: a drive whose fault code
  // cannot be confirmed is treated like a drive reporting a fault, and a drive
  // without fresh speed feedback is stopped rather than driven blind.
  const auto now = steadyNowNs();
  const auto staleness = [&](const core::PollFreshness & f) {
      return std::to_string(f.consecutive_failed_polls) + " failed poll(s) in a row, last good "
             "read " + std::to_string((now - f.last_ok_ns) / 1'000'000) + " ms ago (limit " +
             std::to_string(core::BENCH_MAX_FAILED_POLLS) + " polls or " +
             std::to_string(bench_poll_stale_after_ns_ / 1'000'000) + " ms)";
    };
  for (std::size_t w = 0; w < WHEEL_COUNT; ++w) {
    const std::string wheel = wheels_[w].joint_name + " (ID " +
      std::to_string(wheels_[w].slave_id) + ")";
    if (core::pollsStale(bench_fault_freshness_[w], now, bench_poll_stale_after_ns_)) {
      return benchSafetyStop(wheel + " fault code not confirmed: " +
        staleness(bench_fault_freshness_[w]));
    }
    if (core::pollsStale(bench_speed_freshness_[w], now, bench_poll_stale_after_ns_)) {
      return benchSafetyStop("speed feedback lost on " + wheel + ": " +
        staleness(bench_speed_freshness_[w]));
    }
  }
  return ReturnType::OK;
}

ReturnType RoverHardwareInterface::benchWrite()
{
  std::lock_guard<std::mutex> lock(bench_mutex_);
  if (!active_) {
    bool expected = false;
    if (write_blocked_logged_.compare_exchange_strong(expected, true)) {
      RCLCPP_ERROR(logger(), "write() called while bench motion is not active. "
        "No motor command was sent.");
    }
    return ReturnType::ERROR;
  }
  if (bench_stop_latched_) {
    return ReturnType::ERROR;
  }
  if (!bench_cycle_open_) {
    std::array<std::uint8_t, WHEEL_COUNT> ids{};
    for (std::size_t w = 0; w < WHEEL_COUNT; ++w) ids[w] = wheels_[w].slave_id;
    if (!driver_->beginCycle(ids)) {
      return benchSafetyStop("could not start a bus cycle");
    }
    bench_cycle_open_ = true;
  }

  const auto now = steadyNowNs();
  for (std::size_t w = 0; w < WHEEL_COUNT; ++w) {
    const auto & wheel = wheels_[w];
    const double cap = std::min(bench_rpm_cap_, wheel.motor_rpm_limit);
    const auto target = core::benchMotorCommand(
      command_velocity_rad_s_[w], wheel.gear_ratio, wheel.mirrored, cap);
    core::BenchStartGate gate;
    gate.last_motion_direction = bench_last_motion_direction_[w];
    gate.reversal_clear = core::benchReversalClear(bench_near_zero_since_stop_[w],
      bench_speed_read_since_stop_[w], bench_cycle_index_ - bench_stop_cycle_[w]);
    const auto planned = core::planBenchWrite(bench_output_[w], target, now,
      bench_resend_after_ns_, static_cast<std::uint16_t>(std::lround(cap)), gate);
    if (planned.reg == core::BenchRegister::NONE) {
      continue;
    }
    const bool is_stop = planned.reg == core::BenchRegister::CONTROL && planned.value == 0;
    // A re-sent stop must not restart the reversal hold; only a new stop does.
    const bool was_stopped = bench_output_[w].direction_known && bench_output_[w].direction == 0;
    const auto r = planned.reg == core::BenchRegister::CONTROL ?
      driver_->writeControlRaw(wheel.slave_id, planned.value) :
      driver_->writeSpeedRaw(wheel.slave_id, planned.value);
    const std::string who = wheel.joint_name + " (ID " + std::to_string(wheel.slave_id) + ")";
    if (r.code == Bld305sDriver::ErrorCode::SKIPPED_THIS_CYCLE) {
      if (is_stop) {
        // An earlier exchange with this drive failed this cycle, so its stop
        // was not sent. Stopping the others alone would stop one side only.
        return benchSafetyStop(who + " stop write skipped this cycle");
      }
      continue;  // nothing sent; the state stays as it was
    }
    core::recordBenchWrite(bench_output_[w], planned, r.ok(), now);
    if (!r && planned.reg == core::BenchRegister::CONTROL) {
      // The drive may or may not have taken it. Re-syncing this drive alone
      // would stop one side only, so stop all four instead.
      return benchSafetyStop(who + (is_stop ? " stop" : " direction") + " write failed (" +
        describe(r) + "); its state is unknown");
    }
    if (r && is_stop) {
      if (!was_stopped) markStopAccepted(w);
    } else if (r && planned.reg == core::BenchRegister::CONTROL) {
      bench_last_motion_direction_[w] = static_cast<std::uint8_t>(planned.value);
    }
  }

  endOpenCycle();
  ++bench_cycle_index_;

  // Existing per-cycle health: invalid after 2 missed cycles, lost after 3.
  for (std::size_t w = 0; w < WHEEL_COUNT; ++w) {
    const auto id = wheels_[w].slave_id;
    communication_state_[w] = driver_->communicationState(id);
    // No NaN when telemetry turns invalid (2 missed cycles): the velocity stays
    // at its last good value, and the third miss or a stale poll stops all four.
    if (communication_state_[w] == Bld305sDriver::CommunicationState::LOST) {
      return benchSafetyStop(wheels_[w].joint_name + " (ID " + std::to_string(id) + ") lost");
    }
  }
  return ReturnType::OK;
}

}  // namespace rover_drivetrain_control
