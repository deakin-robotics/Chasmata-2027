#include <rclcpp/rclcpp.hpp>

#include "prod_rover/arm_control.hpp"
#include "prod_rover/rover_control.hpp"

int main(int argc, char * argv[])
{
  rclcpp::init(argc, argv);
  rclcpp::executors::MultiThreadedExecutor executor;
  executor.add_node(prod_rover::make_rover_control_node());
  executor.add_node(prod_rover::make_arm_control_node());
  executor.spin();
  rclcpp::shutdown();
  return 0;
}
