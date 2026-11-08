#include "real_drive_backend.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace mock_rover
{
using namespace std::chrono_literals;
namespace
{
constexpr char kHardware[] = "DCRDrivetrain";
constexpr char kManual[] = "wheel_velocity_controller";
constexpr char kVelocity[] = "diff_drive_controller";
}

RealDriveBackend::RealDriveBackend(rclcpp::Node & node, double max_wheel_speed)
: max_wheel_speed_(max_wheel_speed)
{
  if (!std::isfinite(max_wheel_speed_) || max_wheel_speed_ <= 0.0) {
    throw std::invalid_argument("drive_max_wheel_speed must be a positive finite rad/s value for the real drivetrain");
  }
  const std::string manager = "/drivetrain/controller_manager/";
  hardware_client_ = node.create_client<Hardware>(manager + "list_hardware_components");
  controllers_client_ = node.create_client<Controllers>(manager + "list_controllers");
  switch_client_ = node.create_client<Switch>(manager + "switch_controller");
  publisher_ = node.create_publisher<std_msgs::msg::Float64MultiArray>("/drivetrain/direct/wheel_speeds", 10);
}

void RealDriveBackend::request_mode(const std::string & mode)
{
  result_.reset();
  if (mode != "MANUAL") { stage_ = Stage::idle; result_ = false; return; }
  manual_active_ = false;
  stop();
  stage_ = Stage::waiting_services;
  deadline_ = std::chrono::steady_clock::now() + 3s;
}

void RealDriveBackend::cancel_mode_request()
{
  stage_ = Stage::idle;
  result_.reset();
}

void RealDriveBackend::send_hardware_request(Stage next)
{
  hardware_future_ = hardware_client_->async_send_request(std::make_shared<Hardware::Request>()).future.share();
  stage_ = next;
}

void RealDriveBackend::send_controllers_request(Stage next)
{
  controllers_future_ = controllers_client_->async_send_request(std::make_shared<Controllers::Request>()).future.share();
  stage_ = next;
}

std::optional<bool> RealDriveBackend::finish(bool success)
{
  stage_ = Stage::idle;
  if (success) manual_active_ = true;
  return success;
}

std::optional<bool> RealDriveBackend::take_mode_result()
{
  if (result_) { auto result = result_; result_.reset(); return result; }
  if (stage_ == Stage::idle) return std::nullopt;
  if (std::chrono::steady_clock::now() >= deadline_) return finish(false);
  if (stage_ == Stage::waiting_services) {
    if (hardware_client_->service_is_ready() && controllers_client_->service_is_ready() && switch_client_->service_is_ready()) send_hardware_request(Stage::hardware);
  } else if ((stage_ == Stage::hardware || stage_ == Stage::verify_hardware) && hardware_future_.wait_for(0s) == std::future_status::ready) {
    const auto & components = hardware_future_.get()->component;
    const auto active = std::any_of(components.begin(), components.end(), [](const auto & item) {
      return item.name == kHardware && item.state.label == "active";
    });
    if (!active) return finish(false);
    if (stage_ == Stage::verify_hardware) return finish(true);
    send_controllers_request(Stage::controllers);
  } else if ((stage_ == Stage::controllers || stage_ == Stage::verify) && controllers_future_.wait_for(0s) == std::future_status::ready) {
    const auto controllers = controllers_future_.get()->controller;
    const auto active = [&controllers](const std::string & name) {
      return std::any_of(controllers.begin(), controllers.end(), [&name](const auto & item) { return item.name == name && item.state == "active"; });
    };
    if (active(kManual)) { send_hardware_request(Stage::verify_hardware); return std::nullopt; }
    if (stage_ == Stage::verify) return finish(false);
    auto request = std::make_shared<Switch::Request>();
    request->activate_controllers = {kManual};
    if (active(kVelocity)) request->deactivate_controllers = {kVelocity};
    request->strictness = Switch::Request::STRICT;
    switch_future_ = switch_client_->async_send_request(request).future.share();
    stage_ = Stage::switching;
  } else if (stage_ == Stage::switching && switch_future_.wait_for(0s) == std::future_status::ready) {
    if (!switch_future_.get()->ok) return finish(false);
    send_controllers_request(Stage::verify);
  }
  return std::nullopt;
}

void RealDriveBackend::stop()
{
  std_msgs::msg::Float64MultiArray command;
  command.data = {0.0, 0.0, 0.0, 0.0};
  publisher_->publish(command);
}

void RealDriveBackend::on_joy(const sensor_msgs::msg::Joy & joy)
{
  if (!manual_active_) return;
  const auto left = joy.axes.at(4);
  const auto right = joy.axes.at(5);
  const bool pressed = joy.buttons.size() > 3 && joy.buttons[3] == 1;
  if (pressed && !y_pressed_) {
    reverse_ = !reverse_;
    if (left > 0.0 || right > 0.0) wait_for_release_ = true;
  }
  y_pressed_ = pressed;
  if (wait_for_release_) {
    if (left == 0.0 && right == 0.0) wait_for_release_ = false;
    stop();
    return;
  }
  const auto direction = reverse_ ? -1.0 : 1.0;
  std_msgs::msg::Float64MultiArray command;
  command.data = {direction * left * max_wheel_speed_, direction * left * max_wheel_speed_,
    direction * right * max_wheel_speed_, direction * right * max_wheel_speed_};
  publisher_->publish(command);
}
}  // namespace mock_rover
