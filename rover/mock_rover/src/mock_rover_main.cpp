#include <rclcpp/rclcpp.hpp>

#include "mock_rover/arm_control.hpp"
#include "mock_rover/rover_control.hpp"

int main(int argc, char * argv[])
{
  rclcpp::init(argc, argv);
  rclcpp::executors::MultiThreadedExecutor executor;
  executor.add_node(mock_rover::make_rover_control_node());
  executor.add_node(mock_rover::make_arm_control_node());
  executor.spin();
  rclcpp::shutdown();
  return 0;
}
