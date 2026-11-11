#include <rclcpp/rclcpp.hpp>

#include "rover/rover_node.hpp"

int main(int argc, char * argv[])
{
  rclcpp::init(argc, argv);
  rclcpp::spin(rover::make_rover_node());
  rclcpp::shutdown();
  return 0;
}
