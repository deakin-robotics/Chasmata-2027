#include "dcr_arm_driver/single_motor_bench.hpp"

int main(int argc, char **argv) {
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<dcr_arm_driver::SingleMotorBench>());
  rclcpp::shutdown();
  return 0;
}
