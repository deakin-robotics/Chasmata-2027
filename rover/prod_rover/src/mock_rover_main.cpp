#include <rclcpp/rclcpp.hpp>

#include "mock_rover/mock_rover_node.hpp"

int main(int argc, char * argv[])
{
  rclcpp::init(argc, argv);
  rclcpp::spin(mock_rover::make_mock_rover_node());
  rclcpp::shutdown();
  return 0;
}
