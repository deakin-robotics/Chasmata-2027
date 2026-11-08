#include "rover_drivetrain_control/rover_hardware_interface.hpp"

#include <rclcpp/rclcpp.hpp>
#include <modbus/modbus.h>
#include <array>
#include <iostream>
#include <stdexcept>
#include <string>

#define CHECK(e) do { if (!(e)) throw std::runtime_error(#e); } while(false)

// In-memory Modbus transport exercises the real hardware lifecycle without a serial port.
struct _modbus { int slave{0}; };
static std::array<std::array<std::uint16_t, 0x140>, 5> mock_registers{};
static bool mock_connection_fails = false;
extern "C" {
modbus_t * modbus_new_rtu(const char *, int, char, int, int) { return new _modbus; }
int modbus_set_response_timeout(modbus_t *, std::uint32_t, std::uint32_t) { return 0; }
int modbus_connect(modbus_t *) { return mock_connection_fails ? -1 : 0; }
void modbus_close(modbus_t *) {}
void modbus_free(modbus_t * context) { delete context; }
int modbus_set_slave(modbus_t * context, int slave) { context->slave = slave; return 0; }
int modbus_read_registers(modbus_t * context, int address, int count, std::uint16_t * value)
{ *value = mock_registers.at(context->slave).at(address); return count; }
int modbus_write_register(modbus_t * context, int address, const std::uint16_t value)
{ mock_registers.at(context->slave).at(address) = value; return 1; }
}

using Hardware = rover_drivetrain_control::RoverHardwareInterface;
using Params = hardware_interface::HardwareComponentInterfaceParams;
using CallbackReturn = hardware_interface::CallbackReturn;

Params singleBusConfiguration()
{
  Params params;
  auto & info = params.hardware_info;
  info.name = "DCRDrivetrainTest";
  info.type = "system";
  info.hardware_parameters = {
    {"serial_device", "/dev/drivetrain-test-do-not-open"},
    {"baud_rate", "38400"}, {"parity", "N"}, {"data_bits", "8"}, {"stop_bits", "1"},
    {"update_hz", "15"}, {"upstream_timeout_ms", "110"}, {"stop_deadline_ms", "300"},
    {"measured_stop_wire_budget_ms", "5"}, {"measured_worst_bus_cycle_ms", "30"},
    {"late_trigger_ms", "100"}
  };
  const std::array<std::string, 4> names{
    "front_left_wheel_joint", "rear_left_wheel_joint",
    "front_right_wheel_joint", "rear_right_wheel_joint"};
  for (std::size_t i = 0; i < names.size(); ++i) {
    hardware_interface::ComponentInfo joint;
    joint.name = names[i];
    joint.type = "joint";
    hardware_interface::InterfaceInfo velocity{};
    velocity.name = "velocity";
    joint.command_interfaces.push_back(velocity);
    joint.state_interfaces.push_back(velocity);
    joint.parameters = {
      {"slave_id", std::to_string(i + 1)}, {"gear_ratio", "50"},
      {"motor_rpm_limit", "2000"}, {"mirrored", i >= 2 ? "true" : "false"}
    };
    info.joints.push_back(joint);
  }
  return params;
}

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  {
    Hardware hardware;
    // The real lifecycle initializes, brakes and deactivates four simulated drives.
    CHECK(hardware.on_init(singleBusConfiguration()) == CallbackReturn::SUCCESS);
    auto commands = hardware.export_command_interfaces();
    CHECK(commands.size() == 4);
    CHECK(hardware.export_state_interfaces().size() == 4);
    rclcpp_lifecycle::State state;
    CHECK(hardware.on_configure(state) == CallbackReturn::SUCCESS);
    CHECK(hardware.on_activate(state) == CallbackReturn::SUCCESS);
    CHECK(hardware.read(rclcpp::Time(0), rclcpp::Duration::from_seconds(0.01)) == hardware_interface::return_type::OK);
    constexpr double speed = 800.0 * 2.0 * 3.14159265358979323846 / (60.0 * 50.0);
    for (auto & command : commands) CHECK(command.set_value(speed));
    CHECK(hardware.write(rclcpp::Time(0), rclcpp::Duration::from_seconds(0.01)) == hardware_interface::return_type::OK);
    CHECK(mock_registers[1][0x0056] == 800 && mock_registers[1][0x0066] == 1);
    CHECK(mock_registers[3][0x0056] == 800 && mock_registers[3][0x0066] == 2);
    for (auto & command : commands) CHECK(command.set_value(0.0));
    CHECK(hardware.write(rclcpp::Time(0), rclcpp::Duration::from_seconds(0.01)) == hardware_interface::return_type::OK);
    CHECK(hardware.on_deactivate(state) == CallbackReturn::SUCCESS);
    for (std::size_t id = 1; id <= 4; ++id) {
      CHECK(mock_registers[id][0x0136] == 1);
      CHECK(mock_registers[id][0x0066] == 3);
    }
    CHECK(hardware.on_cleanup(state) == CallbackReturn::SUCCESS);
  }
  {
    Hardware hardware;
    CHECK(hardware.on_init(singleBusConfiguration()) == CallbackReturn::SUCCESS);
    mock_connection_fails = true;
    CHECK(hardware.on_configure(rclcpp_lifecycle::State()) == CallbackReturn::ERROR);
    mock_connection_fails = false;
  }
  {
    auto params = singleBusConfiguration();
    params.hardware_info.joints[3].parameters["slave_id"] = "1";
    Hardware hardware;
    CHECK(hardware.on_init(params) == CallbackReturn::ERROR);
    CHECK(hardware.export_command_interfaces().empty());
  }
  for (const auto & key : {"serial_device", "baud_rate", "parity", "data_bits", "stop_bits"}) {
    auto params = singleBusConfiguration();
    params.hardware_info.hardware_parameters.erase(key);
    Hardware hardware;
    CHECK(hardware.on_init(params) == CallbackReturn::ERROR);
  }
  {
    auto params = singleBusConfiguration();
    params.hardware_info.hardware_parameters["serial_device"] = "";
    Hardware hardware;
    CHECK(hardware.on_init(params) == CallbackReturn::ERROR);
  }
  {
    auto params = singleBusConfiguration();
    // The full shared-bus budget still has to fit the existing timing bounds.
    params.hardware_info.hardware_parameters["measured_worst_bus_cycle_ms"] = "60";
    Hardware hardware;
    CHECK(hardware.on_init(params) == CallbackReturn::ERROR);
  }
  rclcpp::shutdown();
  std::cout << "single-bus hardware configuration tests passed\n";
}
