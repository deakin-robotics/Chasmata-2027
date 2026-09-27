#include "rover_drivetrain_control/rover_hardware_interface.hpp"

#include <hardware_interface/types/hardware_interface_type_values.hpp>

#include <pluginlib/class_list_macros.hpp>
#include <rclcpp/rclcpp.hpp>

#include <array>
#include <chrono>
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

}  // namespace

hardware_interface::CallbackReturn
RoverHardwareInterface::on_init(
  const hardware_interface::HardwareInfo & info)
{
  const auto base_result =
    hardware_interface::SystemInterface::on_init(info);

  if (base_result != hardware_interface::CallbackReturn::SUCCESS) {
    RCLCPP_ERROR(
      logger(),
      "Base SystemInterface::on_init() failed.");

    return hardware_interface::CallbackReturn::ERROR;
  }

  hardware_info_ = info;

  configuration_valid_ = false;
  transports_open_ = false;
  operationally_ready_ = false;
  active_ = false;

  resetInterfaceStorage();

  if (!parseConfiguration()) {
    RCLCPP_ERROR(
      logger(),
      "Drivetrain hardware configuration is invalid.");

    return hardware_interface::CallbackReturn::ERROR;
  }

  drivers_[busIndex(BusId::LEFT)] =
    std::make_unique<Bld305sDriver>(
    bus_configs_[busIndex(BusId::LEFT)]);

  drivers_[busIndex(BusId::RIGHT)] =
    std::make_unique<Bld305sDriver>(
    bus_configs_[busIndex(BusId::RIGHT)]);

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

  closeDrivers();
  resetInterfaceStorage();

  for (std::size_t bus = 0; bus < BUS_COUNT; ++bus) {
    if (!drivers_[bus]) {
      RCLCPP_ERROR(
        logger(),
        "Cannot configure drivetrain: RS485 bus %zu has no driver instance.",
        bus);

      closeDrivers();
      return hardware_interface::CallbackReturn::ERROR;
    }

    const Bld305sDriver::Result result =
      drivers_[bus]->open();

    if (!result) {
      RCLCPP_ERROR(
        logger(),
        "Failed to open RS485 bus %zu. "
        "Driver error=%u libmodbus_rc=%d errno=%d",
        bus,
        static_cast<unsigned int>(result.code),
        result.libmodbus_return_code,
        result.system_errno);

      closeDrivers();
      return hardware_interface::CallbackReturn::ERROR;
    }
  }

  transports_open_ = true;

  RCLCPP_ERROR(
    logger(),
    "Both Modbus transports opened successfully, but the verified BLD-305S "
    "initialization sequence and velocity conversion are not implemented. "
    "Refusing to mark the drivetrain configured for motion.");

  closeDrivers();
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

  if (!transports_open_) {
    RCLCPP_ERROR(
      logger(),
      "Refusing drivetrain activation: Modbus transports are not open.");

    return hardware_interface::CallbackReturn::ERROR;
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

  if (active_) {
    active_ = false;

    RCLCPP_ERROR(
      logger(),
      "Deactivation reached from ACTIVE state, but a verified motor-stop "
      "sequence is not implemented. Refusing to report successful "
      "deactivation.");

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

  closeDrivers();
  resetInterfaceStorage();

  return hardware_interface::CallbackReturn::SUCCESS;
}

std::vector<hardware_interface::StateInterface>
RoverHardwareInterface::export_state_interfaces()
{
  std::vector<hardware_interface::StateInterface> interfaces;
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

  updateIoHeartbeat();

  if (!active_ || !operationally_ready_) {
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

  auto parse_bus_configuration =
    [&parameters](
      const std::string & prefix,
      Bld305sDriver::RtuConfig & config) -> bool
    {
      const std::string device_key = prefix + "_serial_device";
      const std::string parity_key = prefix + "_parity";
      const std::string data_bits_key = prefix + "_data_bits";
      const std::string stop_bits_key = prefix + "_stop_bits";
      const std::string timeout_key = prefix + "_response_timeout_ms";

      const auto device_it = parameters.find(device_key);
      const auto parity_it = parameters.find(parity_key);
      const auto data_bits_it = parameters.find(data_bits_key);
      const auto stop_bits_it = parameters.find(stop_bits_key);

      if (
        device_it == parameters.end() ||
        parity_it == parameters.end() ||
        data_bits_it == parameters.end() ||
        stop_bits_it == parameters.end())
      {
        RCLCPP_ERROR(
          logger(),
          "Missing required serial configuration for '%s' RS485 bus.",
          prefix.c_str());

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
      config.parity = parity_it->second[0];
      config.data_bits = static_cast<int>(data_bits);
      config.stop_bits = static_cast<int>(stop_bits);
      config.response_timeout =
        std::chrono::milliseconds(timeout_ms);

      return true;
    };

  if (
    !parse_bus_configuration(
      "left",
      bus_configs_[busIndex(BusId::LEFT)]))
  {
    return false;
  }

  if (
    !parse_bus_configuration(
      "right",
      bus_configs_[busIndex(BusId::RIGHT)]))
  {
    return false;
  }

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

  const auto bus_it =
    joint.parameters.find("bus");

  const auto slave_it =
    joint.parameters.find("slave_id");

  if (
    bus_it == joint.parameters.end() ||
    slave_it == joint.parameters.end())
  {
    RCLCPP_ERROR(
      logger(),
      "Joint '%s' requires both 'bus' and 'slave_id' parameters.",
      joint.name.c_str());

    return false;
  }

  BusId bus{};

  if (!parseBusId(bus_it->second, bus)) {
    RCLCPP_ERROR(
      logger(),
      "Joint '%s' has invalid bus '%s'. Expected 'left' or 'right'.",
      joint.name.c_str(),
      bus_it->second.c_str());

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

  wheels_[wheel_index].joint_name = joint.name;
  wheels_[wheel_index].bus = bus;
  wheels_[wheel_index].slave_id =
    static_cast<std::uint8_t>(slave_id);

  return true;
}

bool RoverHardwareInterface::validateWheelMapping() const
{
  std::array<bool, 5> seen_slave_ids{
    false, false, false, false, false
  };

  std::array<std::size_t, BUS_COUNT> bus_counts{
    0, 0
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

    const std::size_t bus_index =
      busIndex(wheels_[wheel].bus);

    if (bus_index >= BUS_COUNT) {
      return false;
    }

    ++bus_counts[bus_index];
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

  if (
    bus_counts[busIndex(BusId::LEFT)] != 2 ||
    bus_counts[busIndex(BusId::RIGHT)] != 2)
  {
    RCLCPP_ERROR(
      logger(),
      "Expected exactly two wheels on each RS485 bus. "
      "Configured counts: left=%zu right=%zu.",
      bus_counts[busIndex(BusId::LEFT)],
      bus_counts[busIndex(BusId::RIGHT)]);

    return false;
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

bool RoverHardwareInterface::parseBusId(
  const std::string & value,
  BusId & bus)
{
  if (value == "left") {
    bus = BusId::LEFT;
    return true;
  }

  if (value == "right") {
    bus = BusId::RIGHT;
    return true;
  }

  return false;
}

Bld305sDriver *
RoverHardwareInterface::driverForWheel(
  std::size_t wheel_index) noexcept
{
  if (wheel_index >= WHEEL_COUNT) {
    return nullptr;
  }

  const std::size_t bus_index =
    busIndex(wheels_[wheel_index].bus);

  if (bus_index >= BUS_COUNT) {
    return nullptr;
  }

  return drivers_[bus_index].get();
}

const Bld305sDriver *
RoverHardwareInterface::driverForWheel(
  std::size_t wheel_index) const noexcept
{
  if (wheel_index >= WHEEL_COUNT) {
    return nullptr;
  }

  const std::size_t bus_index =
    busIndex(wheels_[wheel_index].bus);

  if (bus_index >= BUS_COUNT) {
    return nullptr;
  }

  return drivers_[bus_index].get();
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

void RoverHardwareInterface::closeDrivers() noexcept
{
  for (auto & driver : drivers_) {
    if (driver) {
      driver->close();
    }
  }

  transports_open_ = false;
}

}  // namespace rover_drivetrain_control

PLUGINLIB_EXPORT_CLASS(
  rover_drivetrain_control::RoverHardwareInterface,
  hardware_interface::SystemInterface)
