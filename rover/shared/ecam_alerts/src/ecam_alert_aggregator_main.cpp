#include <memory>

#include <rclcpp/rclcpp.hpp>

#include "ecam_alerts/aggregator.hpp"

int main(int argc, char * argv[])
{
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<ecam_alerts::EcamAlertAggregator>());
  rclcpp::shutdown();
  return 0;
}
