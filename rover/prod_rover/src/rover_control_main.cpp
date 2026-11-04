#include <rclcpp/rclcpp.hpp>

#include "prod_rover/rover_control_node.hpp"

int main(int argc, char * argv[])
{
  rclcpp::init(argc, argv);
  rclcpp::spin(prod_rover::make_rover_control_node());
  rclcpp::shutdown();
  return 0;
}
