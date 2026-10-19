// Software-only check: can pluginlib discover and instantiate the drivetrain
// hardware interface? Does not call on_init(), open a serial port, or command
// any motor.

#include <hardware_interface/system_interface.hpp>
#include <pluginlib/class_loader.hpp>

#include <algorithm>
#include <exception>
#include <iostream>
#include <string>

int main()
{
  const std::string plugin_name =
    "rover_drivetrain_control/RoverHardwareInterface";

  try {
    pluginlib::ClassLoader<hardware_interface::SystemInterface> loader(
      "hardware_interface",
      "hardware_interface::SystemInterface");

    const auto classes = loader.getDeclaredClasses();

    if (std::find(classes.begin(), classes.end(), plugin_name)
      == classes.end())
    {
      std::cerr << "FAIL: Plugin not discovered\n";
      return 1;
    }

    std::cout << "Plugin discovered successfully\n";

    auto plugin = loader.createSharedInstance(plugin_name);

    if (!plugin) {
      std::cerr << "FAIL: Plugin instance is null\n";
      return 1;
    }

    std::cout << "PASS: Plugin loaded successfully\n";
    return 0;
  } catch (const std::exception & e) {
    std::cerr << "Plugin loading failed: " << e.what() << '\n';
    return 1;
  }
}
