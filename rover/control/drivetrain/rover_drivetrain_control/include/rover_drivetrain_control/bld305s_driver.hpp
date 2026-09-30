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
    UNSUPPORTED
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
    std::uint32_t consecutive_failures{0};
  };

  static constexpr int BAUD_RATE = 9600;
  static constexpr std::uint32_t COMM_FAILURE_LIMIT = 3;

  explicit Bld305sDriver(RtuConfig config);
  ~Bld305sDriver();

  Bld305sDriver(const Bld305sDriver &) = delete;
  Bld305sDriver & operator=(const Bld305sDriver &) = delete;
  Bld305sDriver(Bld305sDriver &&) = delete;
  Bld305sDriver & operator=(Bld305sDriver &&) = delete;

  [[nodiscard]] Result open();
  void close();
  [[nodiscard]] bool isOpen() const noexcept;

  [[nodiscard]] Result writeSpeedRaw(
    std::uint8_t slave_id,
    std::uint16_t raw_speed);

  [[nodiscard]] Result readSpeedRaw(
    std::uint8_t slave_id,
    std::uint16_t & raw_speed);

  [[nodiscard]] Result writeControlRaw(
    std::uint8_t slave_id,
    std::uint16_t raw_control);

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

  [[nodiscard]] const std::string & device() const noexcept;

private:
  // UNVERIFIED — cross-check against manual
  static constexpr std::uint16_t SPEED_REGISTER = 0x0056;

  // UNVERIFIED — cross-check against manual
  static constexpr std::uint16_t CONTROL_REGISTER = 0x0066;

  // UNVERIFIED — cross-check against manual
  static constexpr std::uint16_t INIT_REGISTER_0136 = 0x0136;

  // UNVERIFIED — cross-check against manual
  static constexpr std::uint16_t INIT_REGISTER_0116 = 0x0116;

  static constexpr std::uint16_t TEMPERATURE_REGISTER = 0x0096;
  static constexpr std::uint16_t CURRENT_REGISTER = 0x00B6;
  static constexpr std::uint16_t VOLTAGE_REGISTER = 0x00C6;

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

  RtuConfig config_;
  modbus_t * context_{nullptr};
  std::atomic<bool> connected_{false};
  std::array<SlaveRuntimeState, 248> slave_states_{};
  mutable std::mutex transaction_mutex_;
};

}  // namespace rover_drivetrain_control

#endif  // ROVER_DRIVETRAIN_CONTROL__BLD305S_DRIVER_HPP_
