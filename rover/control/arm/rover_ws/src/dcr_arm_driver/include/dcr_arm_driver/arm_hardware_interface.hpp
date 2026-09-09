#ifndef DCR_ARM_DRIVER_ARM_HARDWARE_INTERFACE_HPP_
#define DCR_ARM_DRIVER_ARM_HARDWARE_INTERFACE_HPP_

#include <vector>
#include <string>
#include <memory>

#include <hardware_interface/system_interface.hpp>
#include <hardware_interface/handle.hpp>
#include <hardware_interface/hardware_info.hpp>
//#include <hardware_component_interface_params.hpp>
#include <hardware_interface/types/hardware_interface_return_values.hpp>
#include <rclcpp/rclcpp.hpp>
#include <can_msgs/msg/frame.hpp>

#include "dcr_arm_driver/motor.hpp"

namespace dcr_arm_driver {

struct JointInfo {
  std::string name;
  uint32_t can_id;
  double position = 0.0;
  double velocity = 0.0;
  double effort = 0.0;
  double position_command = 0.0;
};

class ArmHardwareInterface : public hardware_interface::SystemInterface {
 public:
  ArmHardwareInterface() = default;
  ~ArmHardwareInterface() = default;

  hardware_interface::CallbackReturn on_init(
      const hardware_interface::HardwareComponentInterfaceParams& params) override;

  hardware_interface::CallbackReturn on_configure(
      const rclcpp_lifecycle::State& previous_state) override;

  hardware_interface::CallbackReturn on_activate(
      const rclcpp_lifecycle::State& previous_state) override;

  hardware_interface::CallbackReturn on_deactivate(
      const rclcpp_lifecycle::State& previous_state) override;

  hardware_interface::CallbackReturn on_cleanup(
      const rclcpp_lifecycle::State& previous_state) override;

  hardware_interface::CallbackReturn on_shutdown(
      const rclcpp_lifecycle::State& previous_state) override;

  hardware_interface::CallbackReturn on_error(
      const rclcpp_lifecycle::State& previous_state) override;

  std::vector<hardware_interface::StateInterface> export_state_interfaces()
      override;

  std::vector<hardware_interface::CommandInterface>
  export_command_interfaces() override;

  hardware_interface::return_type read(const rclcpp::Time& time,
                                       const rclcpp::Duration& period) override;

  hardware_interface::return_type write(const rclcpp::Time& time,
                                        const rclcpp::Duration& period)
      override;

 private:
  std::unique_ptr<Motor> motor_driver_;
  std::string can_interface_;
  rclcpp::Publisher<can_msgs::msg::Frame>::SharedPtr can_pub_;
  rclcpp::Subscription<can_msgs::msg::Frame>::SharedPtr can_sub_;

  std::vector<JointInfo> joints_;

  void can_frame_callback(const can_msgs::msg::Frame& msg);
};

}  // namespace dcr_arm_driver

#endif  // DCR_ARM_DRIVER_ARM_HARDWARE_INTERFACE_HPP_