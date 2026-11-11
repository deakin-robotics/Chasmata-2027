#include "rover_drivetrain_control/rover_hardware_interface.hpp"

#include <rclcpp/rclcpp.hpp>
#include <iostream>
#include <stdexcept>
#include <string>

#define CHECK(e) do { if (!(e)) throw std::runtime_error(#e); } while(false)

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
    // Initialization validates configuration only; this never opens a serial port.
    CHECK(hardware.on_init(singleBusConfiguration()) == CallbackReturn::SUCCESS);
    CHECK(hardware.export_command_interfaces().size() == 4);
    CHECK(hardware.export_state_interfaces().size() == 4);
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
