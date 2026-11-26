#include "rover_drivetrain_control/rover_hardware_interface.hpp"

#include <hardware_interface/types/hardware_interface_type_values.hpp>

#include <pluginlib/class_list_macros.hpp>
#include <rclcpp/rclcpp.hpp>

#include <array>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstdint>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>

namespace rover_drivetrain_control
{

namespace
{

rclcpp::Logger logger()
{
  return rclcpp::get_logger(
    "rover_drivetrain_control.RoverHardwareInterface");
}

bool parseInteger(
  const std::string & text,
  long long & value)
{
  try {
    std::size_t parsed_characters = 0;

    const long long parsed_value =
      std::stoll(text, &parsed_characters, 10);

    if (parsed_characters != text.size()) {
      return false;
    }

    value = parsed_value;
    return true;
  } catch (const std::exception &) {
    return false;
  }
}

bool parsePositiveDouble(const std::string & text, double & value)
{
  try {
    std::size_t parsed = 0;
    double candidate = std::stod(text, &parsed);
    if (parsed != text.size() || !std::isfinite(candidate) || candidate <= 0.0) {
      return false;
    }
    value = candidate;
    return true;
  } catch (const std::exception &) {
    return false;
  }
}

}  // namespace

hardware_interface::CallbackReturn
RoverHardwareInterface::on_init(
  const hardware_interface::HardwareComponentInterfaceParams & params)
{
  const auto base_result =
    hardware_interface::SystemInterface::on_init(params);

  if (base_result != hardware_interface::CallbackReturn::SUCCESS) {
    RCLCPP_ERROR(
      logger(),
      "Base SystemInterface::on_init() failed.");

    return hardware_interface::CallbackReturn::ERROR;
  }

  hardware_info_ = params.hardware_info;

  configuration_valid_ = false;
  previous_read_tick_ns_ = 0;
  late_trigger_detected_ = false;
  transport_open_ = false;
  operationally_ready_ = false;
  active_ = false;
  bench_configured_ = false;
  bench_stop_latched_ = false;

  resetInterfaceStorage();

  if (!parseConfiguration()) {
    RCLCPP_ERROR(
      logger(),
      "Drivetrain hardware configuration is invalid.");

    return hardware_interface::CallbackReturn::ERROR;
  }

  driver_ = std::make_unique<Bld305sDriver>(bus_config_);
  if (bench_motion_enabled_) {
    driver_->setMandatoryExchangesPerCycle(1);  // one alternating read per cycle
    RCLCPP_WARN(logger(), "BENCH MOTION MODE requested (bench_motion_enabled=true). "
      "Bench only: wheels off the ground, power cutoff held.");
  }

  configuration_valid_ = true;

  RCLCPP_INFO(
    logger(),
    "Rover drivetrain configuration parsed successfully. "
    "This confirms configuration syntax only, not motion readiness.");

  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn
RoverHardwareInterface::on_configure(
  const rclcpp_lifecycle::State & previous_state)
{
  (void)previous_state;

  active_ = false;
  operationally_ready_ = false;

  if (!configuration_valid_) {
    RCLCPP_ERROR(
      logger(),
      "Cannot configure drivetrain: on_init() did not establish "
      "a valid hardware configuration.");

    return hardware_interface::CallbackReturn::ERROR;
  }

  closeDriver();
  resetInterfaceStorage();

  if (!driver_) {
    RCLCPP_ERROR(logger(), "Cannot configure drivetrain: shared RS485 driver is missing.");
    return hardware_interface::CallbackReturn::ERROR;
  }

  const Bld305sDriver::Result result = driver_->open();
  if (!result) {
    RCLCPP_ERROR(
      logger(),
      "Failed to open shared RS485 bus. Driver error=%u libmodbus_rc=%d errno=%d",
      static_cast<unsigned int>(result.code),
      result.libmodbus_return_code,
      result.system_errno);
    closeDriver();
    return hardware_interface::CallbackReturn::ERROR;
  }

  transport_open_ = true;

  if (bench_motion_enabled_) {
    return benchConfigure();
  }

  RCLCPP_ERROR(
    logger(),
    "Shared Modbus transport opened successfully, but the verified BLD-305S "
    "initialization sequence and velocity conversion are not implemented. "
    "Refusing to mark the drivetrain configured for motion.");

  closeDriver();
  operationally_ready_ = false;

  return hardware_interface::CallbackReturn::ERROR;
}

hardware_interface::CallbackReturn
RoverHardwareInterface::on_activate(
  const rclcpp_lifecycle::State & previous_state)
{
  (void)previous_state;

  active_ = false;

  if (!configuration_valid_) {
    RCLCPP_ERROR(
      logger(),
      "Refusing drivetrain activation: configuration is invalid.");

    return hardware_interface::CallbackReturn::ERROR;
  }

  if (!transport_open_) {
    RCLCPP_ERROR(
      logger(),
      "Refusing drivetrain activation: shared Modbus transport is not open.");

    return hardware_interface::CallbackReturn::ERROR;
  }

  if (bench_motion_enabled_) {
    return benchActivate();
  }

  if (!operationally_ready_) {
    RCLCPP_ERROR(
      logger(),
      "Refusing drivetrain activation: verified controller initialization "
      "and velocity conversion have not been established.");

    return hardware_interface::CallbackReturn::ERROR;
  }

  active_ = true;

  read_blocked_logged_.store(false, std::memory_order_release);
  write_blocked_logged_.store(false, std::memory_order_release);

  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn
RoverHardwareInterface::on_deactivate(
  const rclcpp_lifecycle::State & previous_state)
{
  (void)previous_state;

  if (bench_motion_enabled_) {
    return benchDeactivate();
  }

  if (active_) {
    // A failed transition must NOT falsely change local lifecycle state.
    // Motion remains unverified; do not assert that the motor has stopped.
    RCLCPP_ERROR(
      logger(),
      "Cannot deactivate safely because the verified motor-stop sequence "
      "is not implemented. Active state remains unchanged.");

    return hardware_interface::CallbackReturn::ERROR;
  }

  active_ = false;

  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn
RoverHardwareInterface::on_cleanup(
  const rclcpp_lifecycle::State & previous_state)
{
  (void)previous_state;

  active_ = false;
  operationally_ready_ = false;
  bench_configured_ = false;

  closeDriver();
  resetInterfaceStorage();

  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn
RoverHardwareInterface::on_shutdown(
  const rclcpp_lifecycle::State & previous_state)
{
  if (!bench_motion_enabled_) {
    return hardware_interface::SystemInterface::on_shutdown(previous_state);
  }
  return benchShutdown(false);
}

hardware_interface::CallbackReturn
RoverHardwareInterface::on_error(
  const rclcpp_lifecycle::State & previous_state)
{
  if (!bench_motion_enabled_) {
    return hardware_interface::SystemInterface::on_error(previous_state);
  }
  return benchShutdown(true);
}

std::vector<hardware_interface::StateInterface>
RoverHardwareInterface::export_state_interfaces()
{
  std::vector<hardware_interface::StateInterface> interfaces;
  if (!configuration_valid_) {
    RCLCPP_ERROR(logger(), "Refusing to export state interfaces: on_init() has not succeeded.");
    return interfaces;
  }
  interfaces.reserve(WHEEL_COUNT);

  for (std::size_t wheel = 0; wheel < WHEEL_COUNT; ++wheel) {
    interfaces.emplace_back(
      wheels_[wheel].joint_name,
      hardware_interface::HW_IF_VELOCITY,
      &state_velocity_rad_s_[wheel]);
  }

  return interfaces;
}

std::vector<hardware_interface::CommandInterface>
RoverHardwareInterface::export_command_interfaces()
{
  std::vector<hardware_interface::CommandInterface> interfaces;
  if (!configuration_valid_) {
    RCLCPP_ERROR(logger(), "Refusing to export command interfaces: on_init() has not succeeded.");
    return interfaces;
  }
  interfaces.reserve(WHEEL_COUNT);

  for (std::size_t wheel = 0; wheel < WHEEL_COUNT; ++wheel) {
    interfaces.emplace_back(
      wheels_[wheel].joint_name,
      hardware_interface::HW_IF_VELOCITY,
      &command_velocity_rad_s_[wheel]);
  }

  return interfaces;
}

hardware_interface::return_type
RoverHardwareInterface::read(
  const rclcpp::Time & time,
  const rclcpp::Duration & period)
{
  (void)time;
  (void)period;

  const auto now = steadyNowNs();
  if (core::lateTrigger(previous_read_tick_ns_, now, timing_.late_trigger_ms)) {
    late_trigger_detected_ = true;
  }
  previous_read_tick_ns_ = now;
  updateIoHeartbeat();

  if (bench_motion_enabled_) {
    return benchRead();
  }

  if (!active_ || !operationally_ready_ || late_trigger_detected_) {
    bool expected = false;

    if (
      read_blocked_logged_.compare_exchange_strong(
        expected,
        true,
        std::memory_order_acq_rel))
    {
      RCLCPP_ERROR(
        logger(),
        "read() was called while the drivetrain is not in a verified "
        "operational state. No physical velocity is being published.");
    }

    return hardware_interface::return_type::ERROR;
  }

  return hardware_interface::return_type::ERROR;
}

hardware_interface::return_type
RoverHardwareInterface::write(
  const rclcpp::Time & time,
  const rclcpp::Duration & period)
{
  (void)time;
  (void)period;

  updateIoHeartbeat();

  if (bench_motion_enabled_) {
    return benchWrite();
  }

  if (!active_ || !operationally_ready_) {
    bool expected = false;

    if (
      write_blocked_logged_.compare_exchange_strong(
        expected,
        true,
        std::memory_order_acq_rel))
    {
      RCLCPP_ERROR(
        logger(),
        "write() was called while the drivetrain is not in a verified "
        "operational state. No motor command was sent.");
    }

    return hardware_interface::return_type::ERROR;
  }

  return hardware_interface::return_type::ERROR;
}

std::int64_t
RoverHardwareInterface::lastIoHeartbeatNs() const noexcept
{
  return last_io_heartbeat_ns_.load(
    std::memory_order_acquire);
}

bool RoverHardwareInterface::parseConfiguration()
{
  if (hardware_info_.joints.size() != WHEEL_COUNT) {
    RCLCPP_ERROR(
      logger(),
      "Expected exactly %zu drivetrain joints, but received %zu.",
      WHEEL_COUNT,
      hardware_info_.joints.size());

    return false;
  }

  const auto & parameters =
    hardware_info_.hardware_parameters;

  // Off unless exactly "true". Anything other than "true"/"false" is refused,
  // so a typo can never switch the mode silently.
  bench_motion_enabled_ = false;
  const auto bench_it = parameters.find("bench_motion_enabled");
  if (bench_it != parameters.end()) {
    if (bench_it->second == "true") {
      bench_motion_enabled_ = true;
    } else if (bench_it->second != "false") {
      RCLCPP_ERROR(logger(), "bench_motion_enabled must be exactly 'true' or 'false', "
        "got '%s'.", bench_it->second.c_str());
      return false;
    }
  }

  auto parse_bus_configuration =
    [this, &parameters](
      Bld305sDriver::RtuConfig & config) -> bool
    {
      const std::string device_key = "serial_device";
      const std::string baud_key = "baud_rate";
      const std::string parity_key = "parity";
      const std::string data_bits_key = "data_bits";
      const std::string stop_bits_key = "stop_bits";
      const std::string timeout_key = "response_timeout_ms";

      const auto device_it = parameters.find(device_key);
      const auto baud_it = parameters.find(baud_key);
      const auto parity_it = parameters.find(parity_key);
      const auto data_bits_it = parameters.find(data_bits_key);
      const auto stop_bits_it = parameters.find(stop_bits_key);

      if (
        device_it == parameters.end() ||
        baud_it == parameters.end() ||
        parity_it == parameters.end() ||
        data_bits_it == parameters.end() ||
        stop_bits_it == parameters.end())
      {
        RCLCPP_ERROR(
          logger(),
          "Missing required serial configuration for the shared RS485 bus.");

        return false;
      }

      if (device_it->second.empty()) {
        RCLCPP_ERROR(
          logger(),
          "%s cannot be empty.",
          device_key.c_str());

        return false;
      }

      if (
        parity_it->second.size() != 1 ||
        (
          parity_it->second[0] != 'N' &&
          parity_it->second[0] != 'E' &&
          parity_it->second[0] != 'O'))
      {
        RCLCPP_ERROR(
          logger(),
          "%s must be exactly one of N, E or O.",
          parity_key.c_str());

        return false;
      }

      long long baud = 0;
      if (bench_motion_enabled_) {
        // Bench only: the drives are still at last year's 9600 today.
        if (!parseInteger(baud_it->second, baud) || (baud != 9600 && baud != 38400)) {
          RCLCPP_ERROR(logger(), "%s must be 9600 or 38400 in bench mode.", baud_key.c_str());
          return false;
        }
      } else if (!parseInteger(baud_it->second, baud) || baud != 38400) {
        RCLCPP_ERROR(logger(), "%s must be 38400 for the current operating point. "
          "Provision ALL controllers with the vendor tool first.", baud_key.c_str());
        return false;
      }

      long long data_bits = 0;
      long long stop_bits = 0;

      if (
        !parseInteger(data_bits_it->second, data_bits) ||
        data_bits < 5 ||
        data_bits > 8)
      {
        RCLCPP_ERROR(
          logger(),
          "%s must be an integer from 5 through 8.",
          data_bits_key.c_str());

        return false;
      }

      if (
        !parseInteger(stop_bits_it->second, stop_bits) ||
        (stop_bits != 1 && stop_bits != 2))
      {
        RCLCPP_ERROR(
          logger(),
          "%s must be either 1 or 2.",
          stop_bits_key.c_str());

        return false;
      }

      long long timeout_ms = 30;

      const auto timeout_it = parameters.find(timeout_key);

      if (timeout_it != parameters.end()) {
        if (
          !parseInteger(timeout_it->second, timeout_ms) ||
          timeout_ms <= 0)
        {
          RCLCPP_ERROR(
            logger(),
            "%s must be a positive integer.",
            timeout_key.c_str());

          return false;
        }
      }

      if (
        timeout_ms >
        std::chrono::milliseconds::max().count())
      {
        RCLCPP_ERROR(
          logger(),
          "%s is outside the supported duration range.",
          timeout_key.c_str());

        return false;
      }

      config.device = device_it->second;
      config.baud_rate = static_cast<int>(baud);
      config.parity = parity_it->second[0];
      config.data_bits = static_cast<int>(data_bits);
      config.stop_bits = static_cast<int>(stop_bits);
      config.response_timeout =
        std::chrono::milliseconds(timeout_ms);

      return true;
    };

  if (!parse_bus_configuration(bus_config_)) {
    return false;
  }

  // There are NO silent defaults for safety-relevant timing.
  auto required_timing = [&parameters](const char * key, double & dst) -> bool {
    auto it = parameters.find(key);
    if (it == parameters.end() || !parsePositiveDouble(it->second, dst)) {
      RCLCPP_ERROR(logger(), "Missing or invalid positive timing parameter: %s", key);
      return false;
    }
    return true;
  };
  if (!required_timing("update_hz", timing_.update_hz) ||
      !required_timing("upstream_timeout_ms", timing_.upstream_timeout_ms) ||
      !required_timing("stop_deadline_ms", timing_.stop_deadline_ms) ||
      !required_timing("measured_stop_wire_budget_ms", timing_.stop_wire_budget_ms) ||
      !required_timing("measured_worst_bus_cycle_ms", timing_.worst_bus_cycle_ms) ||
      !required_timing("late_trigger_ms", timing_.late_trigger_ms)) {
    return false;
  }
  if (timing_.stop_deadline_ms > 300.0) {
    RCLCPP_ERROR(logger(), "Stop deadline must not exceed the 300 ms team target.");
    return false;
  }
  if (!bench_motion_enabled_ && std::abs(timing_.update_hz - 15.0) > 0.01) {
    RCLCPP_ERROR(logger(), "The drivetrain component rate must be 15 Hz.");
    return false;
  }
  // Bench mode checks the same timing rules against its own stop deadline.
  core::TimingConfig checked_timing = timing_;
  if (bench_motion_enabled_) {
    if (!parseBenchConfiguration()) {
      return false;
    }
    checked_timing.stop_deadline_ms = bench_stop_deadline_ms_;
  }
  const auto timing_check = core::validateTiming(checked_timing);
  if (!timing_check.ok) {
    RCLCPP_ERROR(logger(), "Timing refusal: %s", timing_check.reason.c_str());
    return false;
  }
  RCLCPP_WARN(logger(), "Timing budget passes arithmetic only; bench stop ACK and adapter delays unverified.");

  for (std::size_t wheel = 0; wheel < WHEEL_COUNT; ++wheel) {
    const auto & joint = hardware_info_.joints[wheel];

    if (
      joint.command_interfaces.size() != 1 ||
      joint.command_interfaces[0].name !=
      hardware_interface::HW_IF_VELOCITY)
    {
      RCLCPP_ERROR(
        logger(),
        "Joint '%s' must expose exactly one velocity command interface.",
        joint.name.c_str());

      return false;
    }

    if (
      joint.state_interfaces.size() != 1 ||
      joint.state_interfaces[0].name !=
      hardware_interface::HW_IF_VELOCITY)
    {
      RCLCPP_ERROR(
        logger(),
        "Joint '%s' must expose exactly one velocity state interface.",
        joint.name.c_str());

      return false;
    }

    if (!parseWheelConfiguration(wheel)) {
      return false;
    }
  }

  return validateWheelMapping();
}

bool RoverHardwareInterface::parseWheelConfiguration(
  std::size_t wheel_index)
{
  if (wheel_index >= WHEEL_COUNT) {
    return false;
  }

  const auto & joint =
    hardware_info_.joints[wheel_index];

  const auto slave_it =
    joint.parameters.find("slave_id");

  if (slave_it == joint.parameters.end())
  {
    RCLCPP_ERROR(
      logger(),
      "Joint '%s' requires a 'slave_id' parameter on the shared RS485 bus.",
      joint.name.c_str());

    return false;
  }

  long long slave_id = 0;

  if (
    !parseInteger(slave_it->second, slave_id) ||
    slave_id < 1 ||
    slave_id > 4)
  {
    RCLCPP_ERROR(
      logger(),
      "Joint '%s' has slave_id '%s'. "
      "This rover is confirmed to use IDs 1 through 4.",
      joint.name.c_str(),
      slave_it->second.c_str());

    return false;
  }

  const auto gear_it = joint.parameters.find("gear_ratio");
  const auto mirror_it = joint.parameters.find("mirrored");
  const auto rpm_it = joint.parameters.find("motor_rpm_limit");
  double gear = 0.0, rpm = 0.0;
  if (gear_it == joint.parameters.end() ||
      rpm_it == joint.parameters.end() ||
      mirror_it == joint.parameters.end() ||
      !parsePositiveDouble(gear_it->second, gear) ||
      !parsePositiveDouble(rpm_it->second, rpm) ||
      (mirror_it->second != "true" && mirror_it->second != "false")) {
    RCLCPP_ERROR(logger(), "Joint '%s' requires valid gear_ratio, motor_rpm_limit and mirrored flag.",
      joint.name.c_str());
    return false;
  }
  // Mirroring describes the wheel mounting, independently of the shared bus.
  wheels_[wheel_index].gear_ratio = gear;
  wheels_[wheel_index].motor_rpm_limit = rpm;
  wheels_[wheel_index].mirrored = mirror_it->second == "true";

  wheels_[wheel_index].joint_name = joint.name;
  wheels_[wheel_index].slave_id =
    static_cast<std::uint8_t>(slave_id);

  return true;
}

bool RoverHardwareInterface::validateWheelMapping() const
{
  std::array<bool, 5> seen_slave_ids{
    false, false, false, false, false
  };

  for (std::size_t wheel = 0; wheel < WHEEL_COUNT; ++wheel) {
    const std::uint8_t slave_id =
      wheels_[wheel].slave_id;

    if (slave_id < 1 || slave_id > 4) {
      RCLCPP_ERROR(
        logger(),
        "Wheel '%s' has invalid slave ID %u.",
        wheels_[wheel].joint_name.c_str(),
        static_cast<unsigned int>(slave_id));

      return false;
    }

    if (seen_slave_ids[slave_id]) {
      RCLCPP_ERROR(
        logger(),
        "Modbus slave ID %u is assigned to more than one wheel.",
        static_cast<unsigned int>(slave_id));

      return false;
    }

    seen_slave_ids[slave_id] = true;
  }

  for (std::uint8_t id = 1; id <= 4; ++id) {
    if (!seen_slave_ids[id]) {
      RCLCPP_ERROR(
        logger(),
        "Confirmed Modbus slave ID %u is missing from the wheel mapping.",
        static_cast<unsigned int>(id));

      return false;
    }
  }

  for (std::size_t i = 0; i < WHEEL_COUNT; ++i) {
    for (std::size_t j = i + 1; j < WHEEL_COUNT; ++j) {
      if (wheels_[i].joint_name == wheels_[j].joint_name) {
        RCLCPP_ERROR(
          logger(),
          "Duplicate wheel joint name '%s'.",
          wheels_[i].joint_name.c_str());

        return false;
      }
    }
  }

  return true;
}

Bld305sDriver *
RoverHardwareInterface::driverForWheel(
  std::size_t wheel_index) noexcept
{
  if (wheel_index >= WHEEL_COUNT) {
    return nullptr;
  }

  return driver_.get();
}

const Bld305sDriver *
RoverHardwareInterface::driverForWheel(
  std::size_t wheel_index) const noexcept
{
  if (wheel_index >= WHEEL_COUNT) {
    return nullptr;
  }

  return driver_.get();
}

void RoverHardwareInterface::updateIoHeartbeat() noexcept
{
  last_io_heartbeat_ns_.store(
    steadyNowNs(),
    std::memory_order_release);
}

std::int64_t
RoverHardwareInterface::steadyNowNs() noexcept
{
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
    std::chrono::steady_clock::now().time_since_epoch()).count();
}

void RoverHardwareInterface::resetInterfaceStorage() noexcept
{
  const double unknown =
    std::numeric_limits<double>::quiet_NaN();

  for (std::size_t wheel = 0; wheel < WHEEL_COUNT; ++wheel) {
    command_velocity_rad_s_[wheel] = unknown;
    state_velocity_rad_s_[wheel] = unknown;

    raw_speed_state_[wheel] = 0;
    raw_speed_state_valid_[wheel] = false;

    communication_state_[wheel] =
      Bld305sDriver::CommunicationState::UNKNOWN;

    controller_state_[wheel] =
      Bld305sDriver::ControllerState::UNKNOWN;
  }

  last_io_heartbeat_ns_.store(
    0,
    std::memory_order_release);

  read_blocked_logged_.store(
    false,
    std::memory_order_release);

  write_blocked_logged_.store(
    false,
    std::memory_order_release);
}

void RoverHardwareInterface::closeDriver() noexcept
{
  if (driver_) {
    driver_->close();
  }

  transport_open_ = false;
}

}  // namespace rover_drivetrain_control

PLUGINLIB_EXPORT_CLASS(
  rover_drivetrain_control::RoverHardwareInterface,
  hardware_interface::SystemInterface)
