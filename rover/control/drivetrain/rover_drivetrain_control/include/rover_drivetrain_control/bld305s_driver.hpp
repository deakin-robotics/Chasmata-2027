#ifndef ROVER_DRIVETRAIN_CONTROL__BLD305S_DRIVER_HPP_
#define ROVER_DRIVETRAIN_CONTROL__BLD305S_DRIVER_HPP_

#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <string>

struct _modbus;
using modbus_t = struct _modbus;

namespace rover_drivetrain_control
{

class Bld305sDriver
{
public:
  struct RtuConfig
  {
    std::string device;
    int baud_rate{0};  // REQUIRED: 38400 target; provision with vendor tool
    char parity{'\0'};
    int data_bits{0};
    int stop_bits{0};
    std::chrono::milliseconds response_timeout{30};
  };

  enum class ErrorCode : std::uint8_t
  {
    OK = 0,
    NOT_CONNECTED,
    INVALID_CONFIG,
    INVALID_SLAVE_ID,
    MODBUS_ERROR,
    UNEXPECTED_RETURN_COUNT,
    UNSUPPORTED,
    SKIPPED_THIS_CYCLE,
    INVALID_CYCLE_STATE
  };

  enum class CommunicationState : std::uint8_t
  {
    UNKNOWN = 0,
    HEALTHY,
    DEGRADED,
    LOST
  };

  enum class ControllerState : std::uint8_t
  {
    UNKNOWN = 0,
    UNINITIALIZED,
    INITIALIZED
  };

  struct Result
  {
    ErrorCode code{ErrorCode::OK};
    int libmodbus_return_code{0};
    int system_errno{0};

    [[nodiscard]] bool ok() const noexcept
    {
      return code == ErrorCode::OK;
    }

    explicit operator bool() const noexcept
    {
      return ok();
    }
  };

  struct SlaveRuntimeState
  {
    CommunicationState communication{CommunicationState::UNKNOWN};
    ControllerState controller{ControllerState::UNKNOWN};
    std::uint32_t consecutive_failures{0};  // consecutive FAILED CYCLES, not exchanges
    bool telemetry_valid{false};
    bool skip_remaining_cycle{false};
    bool exchange_failed_cycle{false};
    bool saw_success_cycle{false};
    std::uint8_t success_count_cycle{0};
  };

  static constexpr int TARGET_BAUD_RATE = 38400;  // target baud, bench-gated
  using SlaveIds = std::array<std::uint8_t, 4>;

  explicit Bld305sDriver(RtuConfig config);
  ~Bld305sDriver();

  Bld305sDriver(const Bld305sDriver &) = delete;
  Bld305sDriver & operator=(const Bld305sDriver &) = delete;
  Bld305sDriver(Bld305sDriver &&) = delete;
  Bld305sDriver & operator=(Bld305sDriver &&) = delete;

  [[nodiscard]] Result open();

  // Explicit per-cycle accounting, required to distinguish three failed
  // exchanges inside one cycle from three consecutive failed cycles.
  // Caller MUST invoke beginCycle/endCycle once per 15 Hz control cycle.
  // Any failed transaction skips this slave's remaining exchanges this cycle.
  // Supply all four wheel IDs, in any order, once for the shared bus.
  [[nodiscard]] Result beginCycle(const SlaveIds & slave_ids);
  [[nodiscard]] Result endCycle();
  void close();
  [[nodiscard]] bool isOpen() const noexcept;

  [[nodiscard]] Result writeSpeedRaw(
    std::uint8_t slave_id,
    std::uint16_t raw_speed);

  // Reading a command SETPOINT is not a speed measurement.
  // This is retained only for raw investigation and should never feed odometry.
  [[nodiscard]] Result readSpeedRaw(
    std::uint8_t slave_id,
    std::uint16_t & raw_speed);

  [[nodiscard]] Result writeControlRaw(
    std::uint8_t slave_id,
    std::uint16_t raw_control);

  // 0x005F ACTUAL speed: manual-cited (FC 03), bench check pending.
  // Raw value is never converted to rad/s without a bench read-back.
  [[nodiscard]] Result readActualSpeedRaw(
    std::uint8_t slave_id, std::uint16_t & raw_speed);

  // Read-only (FC 03) probes; see docs/BLD305S_REGISTERS.md. Manual-cited,
  // bench check pending. There are deliberately no matching write methods.
  [[nodiscard]] Result readRunningStatusRaw(
    std::uint8_t slave_id, std::uint16_t & raw_status);

  [[nodiscard]] Result readDriveAddressRaw(
    std::uint8_t slave_id, std::uint16_t & raw_address);

  [[nodiscard]] Result readBaudCodeRaw(
    std::uint8_t slave_id, std::uint16_t & raw_baud_code);

  [[nodiscard]] Result readPolePairsRaw(
    std::uint8_t slave_id, std::uint16_t & raw_pole_pairs);

  // The manual lists 0x0136 for FC 06 only; a read may return an exception.
  [[nodiscard]] Result readControlModeRaw(
    std::uint8_t slave_id, std::uint16_t & raw_mode);

  [[nodiscard]] Result readTemperatureRaw(
    std::uint8_t slave_id,
    std::uint16_t & raw_temperature);

  [[nodiscard]] Result readCurrentRaw(
    std::uint8_t slave_id,
    std::uint16_t & raw_current);

  [[nodiscard]] Result readVoltageRaw(
    std::uint8_t slave_id,
    std::uint16_t & raw_voltage);

  [[nodiscard]] Result readFaultRaw(
    std::uint8_t slave_id,
    std::uint16_t & raw_fault);

  [[nodiscard]] CommunicationState communicationState(
    std::uint8_t slave_id) const;

  [[nodiscard]] ControllerState controllerState(
    std::uint8_t slave_id) const;

  [[nodiscard]] std::uint32_t consecutiveFailures(
    std::uint8_t slave_id) const;

  [[nodiscard]] bool telemetryValid(std::uint8_t slave_id) const;

  // Correlated silence is a SUSPECTED bus outage, not proof of a failed adapter.
  [[nodiscard]] bool allSlavesLost(const SlaveIds & slave_ids) const;

  [[nodiscard]] const std::string & device() const noexcept;

private:
  // UNVERIFIED — cross-check against manual
  static constexpr std::uint16_t SPEED_REGISTER = 0x0056;

  // UNVERIFIED — cross-check against manual
  static constexpr std::uint16_t CONTROL_REGISTER = 0x0066;

  // Manual-cited, bench check pending — actual speed register
  static constexpr std::uint16_t ACTUAL_SPEED_REGISTER = 0x005F;

  // UNVERIFIED — cross-check against manual
  static constexpr std::uint16_t INIT_REGISTER_0136 = 0x0136;

  // UNVERIFIED — cross-check against manual
  static constexpr std::uint16_t INIT_REGISTER_0116 = 0x0116;

  static constexpr std::uint16_t TEMPERATURE_REGISTER = 0x0096;
  static constexpr std::uint16_t CURRENT_REGISTER = 0x00B6;
  static constexpr std::uint16_t VOLTAGE_REGISTER = 0x00C6;

  // Read-only (FC 03) addresses. Manual-cited, bench check pending.
  // 0x0066 is also CONTROL_REGISTER on FC 06; this constant is read-only.
  static constexpr std::uint16_t RUNNING_STATUS_REGISTER = 0x0066;
  static constexpr std::uint16_t FAULT_REGISTER = 0x0076;
  static constexpr std::uint16_t DRIVE_ADDRESS_REGISTER = 0x00A6;
  // Never write: changing the stored baud code drops the drive off the bus.
  static constexpr std::uint16_t BAUD_CODE_REGISTER = 0x00F6;
  // Same addresses as INIT_REGISTER_0116/0136; these names are read-only.
  static constexpr std::uint16_t POLE_PAIRS_REGISTER = 0x0116;
  static constexpr std::uint16_t CONTROL_MODE_REGISTER = 0x0136;

  static constexpr std::uint8_t MIN_SLAVE_ID = 1;
  static constexpr std::uint8_t MAX_SLAVE_ID = 247;

  [[nodiscard]] Result validateConfig() const;
  [[nodiscard]] static bool isValidSlaveId(std::uint8_t slave_id) noexcept;
  [[nodiscard]] Result selectSlaveUnlocked(std::uint8_t slave_id);

  [[nodiscard]] Result readHoldingRegister(
    std::uint8_t slave_id,
    std::uint16_t register_address,
    std::uint16_t & value);

  [[nodiscard]] Result writeSingleRegister(
    std::uint8_t slave_id,
    std::uint16_t register_address,
    std::uint16_t value);

  void recordTransactionSuccessUnlocked(std::uint8_t slave_id) noexcept;
  void recordTransactionFailureUnlocked(std::uint8_t slave_id) noexcept;
  void markTransportOpenedUnlocked() noexcept;
  void markTransportClosedUnlocked() noexcept;
  void closeUnlocked() noexcept;

  bool cycle_active_{false};
  SlaveIds cycle_slaves_{};
  [[nodiscard]] static bool validSlaveIds(const SlaveIds & slave_ids) noexcept;
  [[nodiscard]] bool isExpectedCycleSlave(std::uint8_t slave_id) const noexcept;

  RtuConfig config_;
  modbus_t * context_{nullptr};
  std::atomic<bool> connected_{false};
  std::array<SlaveRuntimeState, 248> slave_states_{};
  mutable std::mutex transaction_mutex_;
};

}  // namespace rover_drivetrain_control

#endif  // ROVER_DRIVETRAIN_CONTROL__BLD305S_DRIVER_HPP_
