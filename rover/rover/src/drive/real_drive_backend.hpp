#pragma once

#include <chrono>
#include <optional>
#include <string>

#include <controller_manager_msgs/srv/list_controllers.hpp>
#include <controller_manager_msgs/srv/list_hardware_components.hpp>
#include <controller_manager_msgs/srv/switch_controller.hpp>
#include <rclcpp/rclcpp.hpp>
#include <geometry_msgs/msg/twist_stamped.hpp>
#include <std_msgs/msg/float64_multi_array.hpp>

#include "rover/drive_backend.hpp"

namespace rover
{
class RealDriveBackend final : public DriveBackend
{
public:
  RealDriveBackend(rclcpp::Node & node, double max_wheel_speed, double wheel_radius, double wheel_separation);
  void request_mode(const std::string & mode) override;
  void cancel_mode_request() override;
  std::optional<bool> take_mode_result() override;
  bool confirmed_mode_valid() const override { return confirmed_mode_valid_; }
  void on_joy(const sensor_msgs::msg::Joy & joy) override;

private:
  using Hardware = controller_manager_msgs::srv::ListHardwareComponents;
  using Controllers = controller_manager_msgs::srv::ListControllers;
  using Switch = controller_manager_msgs::srv::SwitchController;
  enum class Stage { idle, waiting_services, hardware, controllers, switching, verify, verify_hardware,
    rollback_check, rollback_switch, rollback_verify };
  void send_hardware_request(Stage next);
  void send_controllers_request(Stage next);
  void stop();
  std::optional<bool> finish(bool success);
  std::optional<bool> rollback();

  rclcpp::Client<Hardware>::SharedPtr hardware_client_;
  rclcpp::Client<Controllers>::SharedPtr controllers_client_;
  rclcpp::Client<Switch>::SharedPtr switch_client_;
  rclcpp::Publisher<std_msgs::msg::Float64MultiArray>::SharedPtr publisher_;
  rclcpp::Publisher<geometry_msgs::msg::TwistStamped>::SharedPtr velocity_publisher_;
  rclcpp::Clock::SharedPtr clock_;
  rclcpp::Client<Hardware>::SharedFuture hardware_future_;
  rclcpp::Client<Controllers>::SharedFuture controllers_future_;
  rclcpp::Client<Switch>::SharedFuture switch_future_;
  Stage stage_{Stage::idle};
  std::optional<bool> result_;
  std::chrono::steady_clock::time_point deadline_;
  double max_wheel_speed_;
  double wheel_radius_;
  double wheel_separation_;
  std::string active_mode_;
  std::string requested_mode_;
  std::string previous_mode_;
  bool switch_sent_{false};
  bool confirmed_mode_valid_{true};
  bool reverse_{false};
  bool y_pressed_{false};
  bool wait_for_release_{false};
};
}  // namespace rover
