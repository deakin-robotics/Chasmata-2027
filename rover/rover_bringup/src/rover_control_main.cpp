#include <rclcpp/rclcpp.hpp>

#include "rover_bringup/rover_control_node.hpp"

int main(int argc, char * argv[])
{
  rclcpp::init(argc, argv);
  rclcpp::spin(rover_bringup::make_rover_control_node());
  rclcpp::shutdown();
  return 0;
}
