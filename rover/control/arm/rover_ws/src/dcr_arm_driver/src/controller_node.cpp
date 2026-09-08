#include "rclcpp/rclcpp.hpp"
#include "dcr_arm_driver/controller.hpp"

int main(int argc, char* argv[]) {
  rclcpp::init(argc, argv);
  auto node = std::make_shared<dcr_arm_driver::Controller>();
  rclcpp::spin(node);
  rclcpp::shutdown();
  return 0;
}