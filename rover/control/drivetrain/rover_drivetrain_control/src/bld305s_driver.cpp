#include "rover_drivetrain_control/bld305s_driver.hpp"

#include <modbus/modbus.h>

#include <cerrno>
#include <cstdint>
#include <limits>
#include <utility>

namespace rover_drivetrain_control
{

Bld305sDriver::Bld305sDriver(RtuConfig config)
: config_(std::move(config))
{
}

Bld305sDriver::~Bld305sDriver()
{
  close();
}

Bld305sDriver::Result Bld305sDriver::open()
{
  std::lock_guard<std::mutex> lock(transaction_mutex_);

  const Result config_result = validateConfig();
  if (!config_result) {
    return config_result;
  }

  closeUnlocked();

  errno = 0;

  context_ = modbus_new_rtu(
    config_.device.c_str(),
    config_.baud_rate,
    config_.parity,
    config_.data_bits,
    config_.stop_bits);

  if (context_ == nullptr) {
    const int saved_errno = errno;

    connected_.store(false, std::memory_order_release);
    markTransportClosedUnlocked();

    return {ErrorCode::MODBUS_ERROR, -1, saved_errno};
  }

  const auto timeout_ms = config_.response_timeout.count();

  const std::uint32_t timeout_seconds =
    static_cast<std::uint32_t>(timeout_ms / 1000);

  const std::uint32_t timeout_microseconds =
    static_cast<std::uint32_t>((timeout_ms % 1000) * 1000);

  errno = 0;

  const int timeout_rc = modbus_set_response_timeout(
    context_,
    timeout_seconds,
    timeout_microseconds);

  if (timeout_rc == -1) {
    const int saved_errno = errno;
    closeUnlocked();
    return {ErrorCode::MODBUS_ERROR, timeout_rc, saved_errno};
  }

  errno = 0;

  const int connect_rc = modbus_connect(context_);

  if (connect_rc == -1) {
    const int saved_errno = errno;
    closeUnlocked();
    return {ErrorCode::MODBUS_ERROR, connect_rc, saved_errno};
  }

  connected_.store(true, std::memory_order_release);
  markTransportOpenedUnlocked();

  return {ErrorCode::OK, connect_rc, 0};
}

void Bld305sDriver::close()
{
  std::lock_guard<std::mutex> lock(transaction_mutex_);
  closeUnlocked();
}

bool Bld305sDriver::isOpen() const noexcept
{
  return connected_.load(std::memory_order_acquire);
}

Bld305sDriver::Result Bld305sDriver::writeSpeedRaw(
  std::uint8_t slave_id,
  std::uint16_t raw_speed)
{
  // UNVERIFIED — cross-check against manual
  return writeSingleRegister(slave_id, SPEED_REGISTER, raw_speed);
}

Bld305sDriver::Result Bld305sDriver::readSpeedRaw(
  std::uint8_t slave_id,
  std::uint16_t & raw_speed)
{
  // UNVERIFIED — cross-check against manual
  return readHoldingRegister(slave_id, SPEED_REGISTER, raw_speed);
}

Bld305sDriver::Result Bld305sDriver::writeControlRaw(
  std::uint8_t slave_id,
  std::uint16_t raw_control)
{
  // UNVERIFIED — cross-check against manual
  return writeSingleRegister(slave_id, CONTROL_REGISTER, raw_control);
}

Bld305sDriver::Result Bld305sDriver::readActualSpeedRaw(
  std::uint8_t slave_id, std::uint16_t & raw_speed)
{
  // UNVERIFIED — 0x005F is an actual-speed candidate, NOT validated on hardware.
  return readHoldingRegister(slave_id, ACTUAL_SPEED_REGISTER, raw_speed);
}

Bld305sDriver::Result Bld305sDriver::readTemperatureRaw(
  std::uint8_t slave_id,
  std::uint16_t & raw_temperature)
{
  return readHoldingRegister(
    slave_id,
    TEMPERATURE_REGISTER,
    raw_temperature);
}

Bld305sDriver::Result Bld305sDriver::readCurrentRaw(
  std::uint8_t slave_id,
  std::uint16_t & raw_current)
{
  return readHoldingRegister(slave_id, CURRENT_REGISTER, raw_current);
}

Bld305sDriver::Result Bld305sDriver::readVoltageRaw(
  std::uint8_t slave_id,
  std::uint16_t & raw_voltage)
{
  return readHoldingRegister(slave_id, VOLTAGE_REGISTER, raw_voltage);
}

Bld305sDriver::Result Bld305sDriver::readFaultRaw(
  std::uint8_t slave_id,
  std::uint16_t & raw_fault)
{
  (void)raw_fault;

  if (!isValidSlaveId(slave_id)) {
    return {ErrorCode::INVALID_SLAVE_ID, 0, 0};
  }

  return {ErrorCode::UNSUPPORTED, 0, 0};
}

Bld305sDriver::CommunicationState Bld305sDriver::communicationState(
  std::uint8_t slave_id) const
{
  if (!isValidSlaveId(slave_id)) {
    return CommunicationState::UNKNOWN;
  }

  std::lock_guard<std::mutex> lock(transaction_mutex_);
  return slave_states_[slave_id].communication;
}

Bld305sDriver::ControllerState Bld305sDriver::controllerState(
  std::uint8_t slave_id) const
{
  if (!isValidSlaveId(slave_id)) {
    return ControllerState::UNKNOWN;
  }

  std::lock_guard<std::mutex> lock(transaction_mutex_);
  return slave_states_[slave_id].controller;
}

std::uint32_t Bld305sDriver::consecutiveFailures(
  std::uint8_t slave_id) const
{
  if (!isValidSlaveId(slave_id)) {
    return 0;
  }

  std::lock_guard<std::mutex> lock(transaction_mutex_);
  return slave_states_[slave_id].consecutive_failures;
}

bool Bld305sDriver::telemetryValid(std::uint8_t slave_id) const
{
  if (!isValidSlaveId(slave_id)) return false;
  std::lock_guard<std::mutex> lock(transaction_mutex_);
  return slave_states_[slave_id].telemetry_valid;
}

bool Bld305sDriver::bothSlavesLost(std::uint8_t first_id, std::uint8_t second_id) const
{
  if (!isValidSlaveId(first_id) || !isValidSlaveId(second_id) || first_id == second_id) {
    return false;
  }
  std::lock_guard<std::mutex> lock(transaction_mutex_);
  return slave_states_[first_id].communication == CommunicationState::LOST &&
         slave_states_[second_id].communication == CommunicationState::LOST;
}

const std::string & Bld305sDriver::device() const noexcept
{
  return config_.device;
}

Bld305sDriver::Result Bld305sDriver::validateConfig() const
{
  if (config_.baud_rate <= 0) {
    return {ErrorCode::INVALID_CONFIG, 0, 0};
  }

  if (config_.device.empty()) {
    return {ErrorCode::INVALID_CONFIG, 0, 0};
  }

  if (
    config_.parity != 'N' &&
    config_.parity != 'E' &&
    config_.parity != 'O')
  {
    return {ErrorCode::INVALID_CONFIG, 0, 0};
  }

  if (config_.data_bits < 5 || config_.data_bits > 8) {
    return {ErrorCode::INVALID_CONFIG, 0, 0};
  }

  if (config_.stop_bits != 1 && config_.stop_bits != 2) {
    return {ErrorCode::INVALID_CONFIG, 0, 0};
  }

  if (config_.response_timeout.count() <= 0) {
    return {ErrorCode::INVALID_CONFIG, 0, 0};
  }

  constexpr std::uint64_t max_timeout_ms =
    static_cast<std::uint64_t>(
      std::numeric_limits<std::uint32_t>::max()) *
    1000ULL +
    999ULL;

  const auto timeout_ms = config_.response_timeout.count();

  if (static_cast<std::uint64_t>(timeout_ms) > max_timeout_ms) {
    return {ErrorCode::INVALID_CONFIG, 0, 0};
  }

  return {ErrorCode::OK, 0, 0};
}

bool Bld305sDriver::isValidSlaveId(
  std::uint8_t slave_id) noexcept
{
  return slave_id >= MIN_SLAVE_ID && slave_id <= MAX_SLAVE_ID;
}

Bld305sDriver::Result Bld305sDriver::selectSlaveUnlocked(
  std::uint8_t slave_id)
{
  if (!isValidSlaveId(slave_id)) {
    return {ErrorCode::INVALID_SLAVE_ID, 0, 0};
  }

  if (cycle_active_ && isExpectedCycleSlave(slave_id) &&
      slave_states_[slave_id].skip_remaining_cycle) {
    return {ErrorCode::SKIPPED_THIS_CYCLE, 0, 0};
  }

  if (
    context_ == nullptr ||
    !connected_.load(std::memory_order_acquire))
  {
    return {ErrorCode::NOT_CONNECTED, 0, 0};
  }

  errno = 0;

  const int rc =
    modbus_set_slave(context_, static_cast<int>(slave_id));

  if (rc == -1) {
    const int saved_errno = errno;
    return {ErrorCode::MODBUS_ERROR, rc, saved_errno};
  }

  return {ErrorCode::OK, rc, 0};
}

Bld305sDriver::Result Bld305sDriver::readHoldingRegister(
  std::uint8_t slave_id,
  std::uint16_t register_address,
  std::uint16_t & value)
{
  std::lock_guard<std::mutex> lock(transaction_mutex_);

  if (!isValidSlaveId(slave_id)) {
    return {ErrorCode::INVALID_SLAVE_ID, 0, 0};
  }

  if (cycle_active_ && isExpectedCycleSlave(slave_id) &&
      slave_states_[slave_id].skip_remaining_cycle) {
    return {ErrorCode::SKIPPED_THIS_CYCLE, 0, 0};
  }

  if (
    context_ == nullptr ||
    !connected_.load(std::memory_order_acquire))
  {
    return {ErrorCode::NOT_CONNECTED, 0, 0};
  }

  const Result slave_result = selectSlaveUnlocked(slave_id);

  if (!slave_result) {
    return slave_result;
  }

  std::uint16_t register_value = 0;

  errno = 0;

  const int rc = modbus_read_registers(
    context_,
    static_cast<int>(register_address),
    1,
    &register_value);

  if (rc == -1) {
    const int saved_errno = errno;
    recordTransactionFailureUnlocked(slave_id);
    return {ErrorCode::MODBUS_ERROR, rc, saved_errno};
  }

  if (rc != 1) {
    recordTransactionFailureUnlocked(slave_id);
    return {ErrorCode::UNEXPECTED_RETURN_COUNT, rc, 0};
  }

  value = register_value;
  recordTransactionSuccessUnlocked(slave_id);

  return {ErrorCode::OK, rc, 0};
}

Bld305sDriver::Result Bld305sDriver::writeSingleRegister(
  std::uint8_t slave_id,
  std::uint16_t register_address,
  std::uint16_t value)
{
  std::lock_guard<std::mutex> lock(transaction_mutex_);

  if (!isValidSlaveId(slave_id)) {
    return {ErrorCode::INVALID_SLAVE_ID, 0, 0};
  }

  if (cycle_active_ && isExpectedCycleSlave(slave_id) &&
      slave_states_[slave_id].skip_remaining_cycle) {
    return {ErrorCode::SKIPPED_THIS_CYCLE, 0, 0};
  }

  if (
    context_ == nullptr ||
    !connected_.load(std::memory_order_acquire))
  {
    return {ErrorCode::NOT_CONNECTED, 0, 0};
  }

  const Result slave_result = selectSlaveUnlocked(slave_id);

  if (!slave_result) {
    return slave_result;
  }

  errno = 0;

  const int rc = modbus_write_register(
    context_,
    static_cast<int>(register_address),
    static_cast<int>(value));

  if (rc == -1) {
    const int saved_errno = errno;
    recordTransactionFailureUnlocked(slave_id);
    return {ErrorCode::MODBUS_ERROR, rc, saved_errno};
  }

  if (rc != 1) {
    recordTransactionFailureUnlocked(slave_id);
    return {ErrorCode::UNEXPECTED_RETURN_COUNT, rc, 0};
  }

  recordTransactionSuccessUnlocked(slave_id);

  return {ErrorCode::OK, rc, 0};
}

bool Bld305sDriver::isExpectedCycleSlave(std::uint8_t id) const noexcept
{
  return id == cycle_slaves_[0] || id == cycle_slaves_[1];
}

Bld305sDriver::Result Bld305sDriver::beginCycle(
  std::uint8_t first_id, std::uint8_t second_id)
{
  std::lock_guard<std::mutex> lock(transaction_mutex_);
  if (cycle_active_ || !isValidSlaveId(first_id) || !isValidSlaveId(second_id) ||
      first_id == second_id) {
    return {ErrorCode::INVALID_CYCLE_STATE, 0, 0};
  }
  cycle_slaves_ = {{first_id, second_id}};
  cycle_active_ = true;
  for (auto id : cycle_slaves_) {
    auto & state = slave_states_[id];
    state.skip_remaining_cycle = false;
    state.exchange_failed_cycle = false;
    state.saw_success_cycle = false;
    state.success_count_cycle = 0;
  }
  return {ErrorCode::OK, 0, 0};
}

Bld305sDriver::Result Bld305sDriver::endCycle()
{
  std::lock_guard<std::mutex> lock(transaction_mutex_);
  if (!cycle_active_) {
    return {ErrorCode::INVALID_CYCLE_STATE, 0, 0};
  }
  for (auto id : cycle_slaves_) {
    auto & state = slave_states_[id];
    // V0.4 minimum mandatory cycle: speed setpoint, actual-speed read, fault read.
    // Diagnostics are additional rotating reads and do not relax these.
    const bool good = state.success_count_cycle >= 3 && !state.exchange_failed_cycle;
    if (good) {
      state.consecutive_failures = 0;
      state.communication = CommunicationState::HEALTHY;
      state.telemetry_valid = true;
      // A good communication cycle does NOT restore controller initialization.
    } else {
      if (state.consecutive_failures < std::numeric_limits<std::uint32_t>::max()) {
        ++state.consecutive_failures;
      }
      state.telemetry_valid = state.telemetry_valid && state.consecutive_failures < 2;
      state.communication = state.consecutive_failures >= COMM_FAILURE_LIMIT ?
        CommunicationState::LOST : CommunicationState::DEGRADED;
      if (state.communication == CommunicationState::LOST) {
        state.controller = ControllerState::UNKNOWN;
      }
    }
    state.skip_remaining_cycle = false;
    state.exchange_failed_cycle = false;
    state.saw_success_cycle = false;
    state.success_count_cycle = 0;
  }
  cycle_active_ = false;
  cycle_slaves_ = {{0, 0}};
  return {ErrorCode::OK, 0, 0};
}

void Bld305sDriver::recordTransactionSuccessUnlocked(
  std::uint8_t slave_id) noexcept
{
  if (cycle_active_ && isExpectedCycleSlave(slave_id)) {
    auto & state = slave_states_[slave_id];
    state.saw_success_cycle = true;
    if (state.success_count_cycle < 255) ++state.success_count_cycle;
  }
  // Outside a cycle, raw reads/writes never masquerade as 15 Hz health.
}

void Bld305sDriver::recordTransactionFailureUnlocked(
  std::uint8_t slave_id) noexcept
{
  if (cycle_active_ && isExpectedCycleSlave(slave_id)) {
    auto & state = slave_states_[slave_id];
    state.exchange_failed_cycle = true;
    state.skip_remaining_cycle = true;  // AD-14: one wait per failed slave/cycle
  }
}

void Bld305sDriver::markTransportOpenedUnlocked() noexcept
{
  for (
    std::uint16_t slave_id = MIN_SLAVE_ID;
    slave_id <= MAX_SLAVE_ID;
    ++slave_id)
  {
    SlaveRuntimeState & state = slave_states_[slave_id];

    state.communication = CommunicationState::UNKNOWN;
    state.controller = ControllerState::UNINITIALIZED;
    state.consecutive_failures = 0;
    state.telemetry_valid = false;
    state.skip_remaining_cycle = false;
    state.exchange_failed_cycle = false;
    state.saw_success_cycle = false;
    state.success_count_cycle = 0;
  }
}

void Bld305sDriver::markTransportClosedUnlocked() noexcept
{
  for (
    std::uint16_t slave_id = MIN_SLAVE_ID;
    slave_id <= MAX_SLAVE_ID;
    ++slave_id)
  {
    SlaveRuntimeState & state = slave_states_[slave_id];

    state.communication = CommunicationState::UNKNOWN;
    state.controller = ControllerState::UNKNOWN;
    state.consecutive_failures = 0;
    state.telemetry_valid = false;
    state.skip_remaining_cycle = false;
    state.exchange_failed_cycle = false;
    state.saw_success_cycle = false;
    state.success_count_cycle = 0;
  }
}

void Bld305sDriver::closeUnlocked() noexcept
{
  if (context_ != nullptr) {
    if (connected_.load(std::memory_order_acquire)) {
      modbus_close(context_);
    }

    modbus_free(context_);
    context_ = nullptr;
  }

  connected_.store(false, std::memory_order_release);
  cycle_active_ = false;
  cycle_slaves_ = {{0, 0}};
  markTransportClosedUnlocked();
}

}  // namespace rover_drivetrain_control
