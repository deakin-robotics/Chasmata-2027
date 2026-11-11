#include "real_drive_backend.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace rover
{
using namespace std::chrono_literals;
namespace
{
constexpr char kHardware[] = "DCRDrivetrain";
constexpr char kManual[] = "wheel_velocity_controller";
constexpr char kVelocity[] = "diff_drive_controller";
}

RealDriveBackend::RealDriveBackend(rclcpp::Node & node, double max_wheel_speed, double wheel_radius, double wheel_separation)
: clock_(node.get_clock()), max_wheel_speed_(max_wheel_speed), wheel_radius_(wheel_radius), wheel_separation_(wheel_separation)
{
  if (!std::isfinite(max_wheel_speed_) || max_wheel_speed_ <= 0.0) {
    throw std::invalid_argument("drive_max_wheel_speed must be a positive finite rad/s value for the real drivetrain");
  }
  if (!std::isfinite(wheel_radius_) || wheel_radius_ <= 0.0 ||
    !std::isfinite(wheel_separation_) || wheel_separation_ <= 0.0) {
    throw std::invalid_argument("wheel radius and separation must be positive finite values");
  }
  const std::string manager = "/drivetrain/controller_manager/";
  hardware_client_ = node.create_client<Hardware>(manager + "list_hardware_components");
  controllers_client_ = node.create_client<Controllers>(manager + "list_controllers");
  switch_client_ = node.create_client<Switch>(manager + "switch_controller");
  publisher_ = node.create_publisher<std_msgs::msg::Float64MultiArray>("/drivetrain/direct/wheel_speeds", 10);
  velocity_publisher_ = node.create_publisher<geometry_msgs::msg::TwistStamped>("/drivetrain/diff_drive_controller/cmd_vel", 10);
}

void RealDriveBackend::request_mode(const std::string & mode)
{
  if (stage_ != Stage::idle && switch_sent_) {
    // A service request already on the wire cannot be cancelled safely.
    active_mode_.clear(); confirmed_mode_valid_ = false;
    stage_ = Stage::idle; result_ = false; stop(); return;
  }
  result_.reset();
  if (mode != "MANUAL" && mode != "VELOCITY") { stage_ = Stage::idle; result_ = false; return; }
  previous_mode_ = active_mode_;
  switch_sent_ = false;
  requested_mode_ = mode;
  stage_ = Stage::waiting_services;
  deadline_ = std::chrono::steady_clock::now() + 3s;
}

void RealDriveBackend::cancel_mode_request()
{
  if (stage_ != Stage::idle && switch_sent_) {
    active_mode_.clear(); confirmed_mode_valid_ = false; stop();
  }
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
  switch_sent_ = false;
  if (success) { active_mode_ = requested_mode_; confirmed_mode_valid_ = true; }
  return success;
}

std::optional<bool> RealDriveBackend::rollback()
{
  stop();
  if (previous_mode_.empty() || !controllers_client_->service_is_ready()) {
    active_mode_.clear(); confirmed_mode_valid_ = false;
    return finish(false);
  }
  deadline_ = std::chrono::steady_clock::now() + 3s;
  send_controllers_request(Stage::rollback_check);
  return std::nullopt;
}

std::optional<bool> RealDriveBackend::take_mode_result()
{
  if (result_) { auto result = result_; result_.reset(); return result; }
  if (stage_ == Stage::idle) return std::nullopt;
  if (std::chrono::steady_clock::now() >= deadline_) {
    if (switch_sent_) { active_mode_.clear(); confirmed_mode_valid_ = false; stop(); }
    return finish(false);
  }
  if (stage_ == Stage::waiting_services) {
    if (hardware_client_->service_is_ready() && controllers_client_->service_is_ready() && switch_client_->service_is_ready()) send_hardware_request(Stage::hardware);
  } else if ((stage_ == Stage::hardware || stage_ == Stage::verify_hardware) && hardware_future_.wait_for(0s) == std::future_status::ready) {
    const auto & components = hardware_future_.get()->component;
    const auto active = std::any_of(components.begin(), components.end(), [](const auto & item) {
      return item.name == kHardware && item.state.label == "active";
    });
    if (!active) return switch_sent_ ? rollback() : finish(false);
    if (stage_ == Stage::verify_hardware) return finish(true);
    send_controllers_request(Stage::controllers);
  } else if ((stage_ == Stage::controllers || stage_ == Stage::verify ||
    stage_ == Stage::rollback_check || stage_ == Stage::rollback_verify) && controllers_future_.wait_for(0s) == std::future_status::ready) {
    const auto controllers = controllers_future_.get()->controller;
    const auto active = [&controllers](const std::string & name) {
      return std::any_of(controllers.begin(), controllers.end(), [&name](const auto & item) { return item.name == name && item.state == "active"; });
    };
    const bool restoring = stage_ == Stage::rollback_check || stage_ == Stage::rollback_verify;
    const auto & wanted = restoring ? previous_mode_ : requested_mode_;
    const auto * desired = wanted == "MANUAL" ? kManual : kVelocity;
    const auto * other = wanted == "MANUAL" ? kVelocity : kManual;
    if (restoring) {
      if (active(desired) && !active(other)) return finish(false);
      if (stage_ == Stage::rollback_verify) {
        active_mode_.clear(); confirmed_mode_valid_ = false; return finish(false);
      }
      auto request = std::make_shared<Switch::Request>();
      if (!active(desired)) request->activate_controllers = {desired};
      if (active(other)) request->deactivate_controllers = {other};
      request->strictness = Switch::Request::STRICT;
      switch_future_ = switch_client_->async_send_request(request).future.share();
      stage_ = Stage::rollback_switch;
      return std::nullopt;
    }
    if (active(desired) && !active(other)) { send_hardware_request(Stage::verify_hardware); return std::nullopt; }
    if (stage_ == Stage::verify) return rollback();
    // The old controller remains in control through readiness checks. Stop only
    // when ownership is about to change, and suppress input until verified.
    stop();
    auto request = std::make_shared<Switch::Request>();
    request->activate_controllers = {desired};
    if (active(other)) request->deactivate_controllers = {other};
    request->strictness = Switch::Request::STRICT;
    switch_future_ = switch_client_->async_send_request(request).future.share();
    switch_sent_ = true;
    stage_ = Stage::switching;
  } else if (stage_ == Stage::switching && switch_future_.wait_for(0s) == std::future_status::ready) {
    if (!switch_future_.get()->ok) return rollback();
    send_controllers_request(Stage::verify);
  } else if (stage_ == Stage::rollback_switch && switch_future_.wait_for(0s) == std::future_status::ready) {
    if (!switch_future_.get()->ok) { active_mode_.clear(); confirmed_mode_valid_ = false; return finish(false); }
    send_controllers_request(Stage::rollback_verify);
  }
  return std::nullopt;
}

void RealDriveBackend::stop()
{
  std_msgs::msg::Float64MultiArray command;
  command.data = {0.0, 0.0, 0.0, 0.0};
  publisher_->publish(command);
  geometry_msgs::msg::TwistStamped velocity;
  velocity.header.stamp = clock_->now();
  velocity_publisher_->publish(velocity);
}

void RealDriveBackend::on_joy(const sensor_msgs::msg::Joy & joy)
{
  const bool current_controller_in_control = stage_ == Stage::idle ||
    stage_ == Stage::waiting_services || stage_ == Stage::hardware || stage_ == Stage::controllers;
  if (!current_controller_in_control || !confirmed_mode_valid_ || active_mode_.empty()) return;
  if (active_mode_ == "VELOCITY") {
    if (joy.axes.size() < 2 || !std::isfinite(joy.axes[0]) || !std::isfinite(joy.axes[1]) ||
      std::abs(joy.axes[0]) > 1.0 || std::abs(joy.axes[1]) > 1.0) { stop(); return; }
    const double forward = -joy.axes[1];
    const double turn = -joy.axes[0];
    const double scale = std::max(1.0, std::abs(forward) + std::abs(turn));
    const double max_linear = max_wheel_speed_ * wheel_radius_;
    geometry_msgs::msg::TwistStamped command;
    command.header.stamp = clock_->now();
    command.twist.linear.x = max_linear * forward / scale;
    command.twist.angular.z = (2.0 * max_linear / wheel_separation_) * turn / scale;
    velocity_publisher_->publish(command);
    return;
  }
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
}  // namespace rover
