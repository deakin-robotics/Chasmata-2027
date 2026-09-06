#ifndef DCR_ARM_DRIVER_CONTROLLER_HPP_
#define DCR_ARM_DRIVER_CONTROLLER_HPP_

#include <array>
#include <memory>
#include "rclcpp/rclcpp.hpp"
#include "rcl_interfaces/msg/set_parameters_result.hpp"
#include "arm_interfaces/msg/motor_stat1.hpp"
#include "arm_interfaces/msg/motor_stat2.hpp"
#include "can_msgs/msg/frame.hpp"
#include "sensor_msgs/msg/joint_state.hpp"
#include "std_msgs/msg/bool.hpp"
#include "dcr_arm_driver/motor.hpp"

namespace dcr_arm_driver {

constexpr int NUM_JOINTS = 6;
constexpr int JOINT_LIMIT_BUFFER = 5.0f;

struct JointLimit {
  float min;
  float max;
};

class Controller : public rclcpp::Node {
 public:
  Controller();
  ~Controller() = default;

 private:
  // Callbacks
  void joint_command_callback(const sensor_msgs::msg::JointState& msg);
  void can_rx_callback(const can_msgs::msg::Frame& msg);
  void estop_callback(const std_msgs::msg::Bool& msg);
  rcl_interfaces::msg::SetParametersResult parameter_callback(
      const std::vector<rclcpp::Parameter>& params);

  // Timers
  void stat_timer_callback();
  void viz_timer_callback();

  // Utility
  float to_signed_angle(float angle);
  bool check_joint_limits(int joint_id, float speed);

  // Motor and publishers/subscribers
  std::unique_ptr<Motor> motor_;
  rclcpp::Publisher<can_msgs::msg::Frame>::SharedPtr can_tx_pub_;
  rclcpp::Publisher<arm_interfaces::msg::MotorStat1>::SharedPtr stat1_pub_;
  rclcpp::Publisher<arm_interfaces::msg::MotorStat2>::SharedPtr stat2_pub_;
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr viz_pub_;

  rclcpp::Subscription<sensor_msgs::msg::JointState>::SharedPtr
      joint_cmd_sub_;
  rclcpp::Subscription<can_msgs::msg::Frame>::SharedPtr can_rx_sub_;
  rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr estop_sub_;

  // Timers
  rclcpp::TimerBase::SharedPtr stat_timer_;
  rclcpp::TimerBase::SharedPtr viz_timer_;

  // State
  std::array<float, NUM_JOINTS> current_joints_;
  std::array<float, NUM_JOINTS> joint_speeds_;
  std::array<JointLimit, NUM_JOINTS> joint_limits_;
  OnSetParametersCallbackHandle::SharedPtr param_callback_handle_;
};

}  // namespace dcr_arm_driver

#endif  // DCR_ARM_DRIVER_CONTROLLER_HPP_