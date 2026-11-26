#ifndef DCR_ARM_DRIVER_MOTOR_HPP_
#define DCR_ARM_DRIVER_MOTOR_HPP_

#include <cstdint>
#include <string>
#include "can_msgs/msg/frame.hpp"
#include "arm_interfaces/msg/motor_stat1.hpp"
#include "arm_interfaces/msg/motor_stat2.hpp"

namespace dcr_arm_driver {

class Motor {
 public:
  Motor() = default;
  ~Motor() = default;

  // Fault management
  can_msgs::msg::Frame clr_faults();

  // Motor control
  can_msgs::msg::Frame set_home(uint32_t id);
  can_msgs::msg::Frame position_control(uint32_t id, float angle);
  can_msgs::msg::Frame speed_control(uint32_t id, float speed_cmd);

  // Status requests
  can_msgs::msg::Frame send_status_1();
  can_msgs::msg::Frame send_status_2();

  // Status parsing
  arm_interfaces::msg::MotorStat1 read_status_1(
      const can_msgs::msg::Frame& can_stat);
  arm_interfaces::msg::MotorStat2 read_status_2(
      const can_msgs::msg::Frame& can_stat);
};

}  // namespace dcr_arm_driver

#endif  // DCR_ARM_DRIVER_MOTOR_HPP_