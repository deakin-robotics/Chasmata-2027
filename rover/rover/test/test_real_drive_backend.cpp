#include <chrono>
#include <functional>
#include <limits>
#include <thread>

#include <gtest/gtest.h>
#include <std_msgs/msg/string.hpp>
#include <telemetry_interfaces/msg/fma_state.hpp>
#include "rover/rover_node.hpp"
#include "real_drive_backend.hpp"

using namespace std::chrono_literals;
using Hardware = controller_manager_msgs::srv::ListHardwareComponents;
using Controllers = controller_manager_msgs::srv::ListControllers;
using Switch = controller_manager_msgs::srv::SwitchController;

class RealDriveTest : public ::testing::Test
{
protected:
  static void SetUpTestSuite() { int argc = 0; rclcpp::init(argc, nullptr); }
  static void TearDownTestSuite() { rclcpp::shutdown(); }

  void SetUp() override
  {
    rover_ = std::make_shared<rclcpp::Node>("real_drive_test_rover");
    driver_ = std::make_shared<rclcpp::Node>("real_drive_test_manager");
    hardware_service_ = driver_->create_service<Hardware>("/drivetrain/controller_manager/list_hardware_components",
      [this](const std::shared_ptr<Hardware::Request>, std::shared_ptr<Hardware::Response> response) {
        controller_manager_msgs::msg::HardwareComponentState item;
        item.name = "DCRDrivetrain"; item.state.label = hardware_active_ ? "active" : "unconfigured";
        response->component.push_back(item);
      });
    controller_service_ = driver_->create_service<Controllers>("/drivetrain/controller_manager/list_controllers",
      [this](const std::shared_ptr<Controllers::Request>, std::shared_ptr<Controllers::Response> response) {
        controller_manager_msgs::msg::ControllerState manual; manual.name = "wheel_velocity_controller"; manual.state = manual_active_ ? "active" : "inactive";
        controller_manager_msgs::msg::ControllerState velocity; velocity.name = "diff_drive_controller"; velocity.state = manual_active_ ? "inactive" : "active";
        response->controller = {manual, velocity};
      });
    switch_service_ = driver_->create_service<Switch>("/drivetrain/controller_manager/switch_controller",
      [this](const std::shared_ptr<Switch::Request> request, std::shared_ptr<Switch::Response> response) {
        ++switch_calls_;
        EXPECT_EQ(request->activate_controllers.size(), 1U);
        EXPECT_EQ(request->deactivate_controllers.size(), 1U);
        if (fail_after_apply_) {
          manual_active_ = request->activate_controllers.at(0) == "wheel_velocity_controller";
          fail_after_apply_ = false;
          response->ok = false;
          return;
        }
        response->ok = switch_ok_;
        if (switch_ok_) manual_active_ = request->activate_controllers.at(0) == "wheel_velocity_controller";
        if (drop_hardware_after_switch_) hardware_active_ = false;
      });
    commands_ = driver_->create_subscription<std_msgs::msg::Float64MultiArray>("/drivetrain/direct/wheel_speeds", 10,
      [this](std_msgs::msg::Float64MultiArray::SharedPtr message) { received_ = message->data; ++command_count_; });
    velocity_commands_ = driver_->create_subscription<geometry_msgs::msg::TwistStamped>("/drivetrain/diff_drive_controller/cmd_vel", 10,
      [this](geometry_msgs::msg::TwistStamped::SharedPtr message) { velocity_ = *message; ++velocity_count_; });
    backend_ = std::make_unique<rover::RealDriveBackend>(*rover_, 2.0, 0.1, 0.5);
    executor_.add_node(rover_); executor_.add_node(driver_);
    wait([this] { return commands_->get_publisher_count() > 0; }, 2s);
  }
  void TearDown() override { executor_.remove_node(driver_); executor_.remove_node(rover_); }
  bool wait(const std::function<bool()> & predicate, std::chrono::milliseconds timeout)
  {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    while (std::chrono::steady_clock::now() < deadline) {
      executor_.spin_some(); if (predicate()) return true; std::this_thread::sleep_for(10ms);
    }
    return false;
  }
  std::optional<bool> request(const std::string & mode)
  {
    backend_->request_mode(mode);
    std::optional<bool> result;
    wait([&] { result = backend_->take_mode_result(); return result.has_value(); }, 5s);
    return result;
  }
  void send(float left, float right, bool y)
  {
    sensor_msgs::msg::Joy joy; joy.axes = {0, 0, 0, 0, left, right}; joy.buttons = {0, 0, 0, y ? 1 : 0};
    const auto count = command_count_; backend_->on_joy(joy);
    ASSERT_TRUE(wait([&] { return command_count_ > count; }, 1s));
  }
  rclcpp::executors::SingleThreadedExecutor executor_;
  rclcpp::Node::SharedPtr rover_, driver_;
  rclcpp::Service<Hardware>::SharedPtr hardware_service_;
  rclcpp::Service<Controllers>::SharedPtr controller_service_;
  rclcpp::Service<Switch>::SharedPtr switch_service_;
  rclcpp::Subscription<std_msgs::msg::Float64MultiArray>::SharedPtr commands_;
  rclcpp::Subscription<geometry_msgs::msg::TwistStamped>::SharedPtr velocity_commands_;
  std::unique_ptr<rover::RealDriveBackend> backend_;
  bool hardware_active_{true}, manual_active_{false}, switch_ok_{true}, fail_after_apply_{false};
  bool drop_hardware_after_switch_{false};
  size_t command_count_{0};
  size_t velocity_count_{0};
  size_t switch_calls_{0};
  std::vector<double> received_;
  geometry_msgs::msg::TwistStamped velocity_;
};

// Manual handoff activates the wheel controller and maps triggers and direction safely.
TEST_F(RealDriveTest, ManualControlsAndReverseInterlock)
{
  ASSERT_EQ(request("MANUAL"), std::optional<bool>(true));
  send(0.5F, 1.0F, false); EXPECT_EQ(received_, std::vector<double>({1, 1, 2, 2}));
  send(0.5F, 1.0F, true); EXPECT_EQ(received_, std::vector<double>({0, 0, 0, 0}));
  send(0.5F, 1.0F, false); EXPECT_EQ(received_, std::vector<double>({0, 0, 0, 0}));
  send(0.0F, 0.0F, false); EXPECT_EQ(received_, std::vector<double>({0, 0, 0, 0}));
  send(0.5F, 1.0F, false); EXPECT_EQ(received_, std::vector<double>({-1, -1, -2, -2}));
  send(0.0F, 0.0F, true); send(0.5F, 1.0F, true);
  EXPECT_EQ(received_, std::vector<double>({1, 1, 2, 2}));
}

// Unavailable hardware, failed switches, and unsupported modes are rejected.
TEST_F(RealDriveTest, RejectsUnavailableHardwareFailedSwitchAndUnsupportedModes)
{
  hardware_active_ = false;
  EXPECT_EQ(request("MANUAL"), std::optional<bool>(false));
  hardware_active_ = true; switch_ok_ = false;
  EXPECT_EQ(request("MANUAL"), std::optional<bool>(false));
  EXPECT_EQ(request("MANAGED"), std::optional<bool>(false));
}

// Real driving cannot start without an explicitly configured positive speed limit.
TEST_F(RealDriveTest, RequiresWheelSpeedLimit)
{
  EXPECT_THROW(rover::RealDriveBackend(*rover_, 0.0, 0.1, 0.5), std::invalid_argument);
  EXPECT_THROW(rover::RealDriveBackend(*rover_, 2.0, 0.0, 0.5), std::invalid_argument);
}

// FMA confirms real Manual only after the controller handoff and retains it on rejection.
TEST_F(RealDriveTest, RoverFmaReflectsRealBackendHandoff)
{
  auto node = rover::make_rover_node(std::move(backend_));
  executor_.add_node(node);
  auto publisher = driver_->create_publisher<std_msgs::msg::String>("/fma/drive/request", 10);
  telemetry_interfaces::msg::FmaState latest;
  auto subscription = driver_->create_subscription<telemetry_interfaces::msg::FmaState>("/fma/state",
    rclcpp::QoS(1).reliable().transient_local(),
    [&latest](telemetry_interfaces::msg::FmaState::SharedPtr state) { latest = *state; });
  ASSERT_TRUE(wait([&] { return publisher->get_subscription_count() > 0 && subscription->get_publisher_count() > 0; }, 2s));
  hardware_active_ = false;
  std_msgs::msg::String message; message.data = "MANUAL"; publisher->publish(message);
  ASSERT_TRUE(wait([&] { return latest.drive.rejected == "MANUAL"; }, 3s));
  EXPECT_TRUE(latest.drive.confirmed.empty());
  hardware_active_ = true;
  publisher->publish(message);
  ASSERT_TRUE(wait([&] { return latest.drive.confirmed == "MANUAL"; }, 3s));
  EXPECT_TRUE(manual_active_);
  message.data = "VELOCITY"; publisher->publish(message);
  ASSERT_TRUE(wait([&] { return latest.drive.pending == "VELOCITY"; }, 2s));
  EXPECT_EQ(latest.drive.confirmed, "MANUAL");
  ASSERT_TRUE(wait([&] { return latest.drive.confirmed == "VELOCITY"; }, 3s));
  switch_ok_ = false;
  message.data = "MANUAL"; publisher->publish(message);
  ASSERT_TRUE(wait([&] { return latest.drive.rejected == "MANUAL"; }, 3s));
  EXPECT_EQ(latest.drive.confirmed, "VELOCITY");
  message.data = "MANAGED"; publisher->publish(message);
  ASSERT_TRUE(wait([&] { return latest.drive.rejected == "MANAGED"; }, 2s));
  EXPECT_EQ(latest.drive.confirmed, "VELOCITY");
  executor_.remove_node(node);
}

// Velocity maps the left stick to bounded linear/angular commands and switches back to Manual.
TEST_F(RealDriveTest, SwitchesModesAndScalesVelocityCommands)
{
  ASSERT_EQ(request("MANUAL"), std::optional<bool>(true));
  ASSERT_EQ(request("VELOCITY"), std::optional<bool>(true));
  EXPECT_FALSE(manual_active_);
  sensor_msgs::msg::Joy joy; joy.axes = {1.0F, -1.0F, 0, 0, 0, 0};
  auto count = velocity_count_;
  backend_->on_joy(joy);
  ASSERT_TRUE(wait([&] { return velocity_count_ > count; }, 1s));
  EXPECT_NEAR(velocity_.twist.linear.x, 0.1, 1e-9);
  EXPECT_NEAR(velocity_.twist.angular.z, -0.4, 1e-9);
  joy.axes[0] = 0; joy.axes[1] = 1;
  count = velocity_count_; backend_->on_joy(joy);
  ASSERT_TRUE(wait([&] { return velocity_count_ > count; }, 1s));
  EXPECT_NEAR(velocity_.twist.linear.x, -0.2, 1e-9);
  EXPECT_DOUBLE_EQ(velocity_.twist.angular.z, 0.0);
  joy.axes[0] = 0; joy.axes[1] = 0;
  count = velocity_count_; backend_->on_joy(joy);
  ASSERT_TRUE(wait([&] { return velocity_count_ > count; }, 1s));
  EXPECT_DOUBLE_EQ(velocity_.twist.linear.x, 0.0);
  joy.axes[0] = std::numeric_limits<float>::quiet_NaN();
  count = velocity_count_; backend_->on_joy(joy);
  ASSERT_TRUE(wait([&] { return velocity_count_ > count; }, 1s));
  EXPECT_DOUBLE_EQ(velocity_.twist.linear.x, 0.0);
  EXPECT_DOUBLE_EQ(velocity_.twist.angular.z, 0.0);
  ASSERT_EQ(request("MANUAL"), std::optional<bool>(true));
  EXPECT_TRUE(manual_active_);
}

// A rejected controller switch leaves the previously active controller selected.
TEST_F(RealDriveTest, FailedSwitchKeepsPreviousMode)
{
  ASSERT_EQ(request("MANUAL"), std::optional<bool>(true));
  switch_ok_ = false;
  EXPECT_EQ(request("VELOCITY"), std::optional<bool>(false));
  EXPECT_TRUE(manual_active_);
  switch_ok_ = true;
  ASSERT_EQ(request("VELOCITY"), std::optional<bool>(true));
  switch_ok_ = false;
  EXPECT_EQ(request("MANUAL"), std::optional<bool>(false));
  EXPECT_FALSE(manual_active_);
}

// A partially applied failed switch restores the previously confirmed controller.
TEST_F(RealDriveTest, RestoresPreviousControllerAfterPartialFailure)
{
  ASSERT_EQ(request("MANUAL"), std::optional<bool>(true));
  fail_after_apply_ = true;
  EXPECT_EQ(request("VELOCITY"), std::optional<bool>(false));
  EXPECT_TRUE(manual_active_);
  EXPECT_TRUE(backend_->confirmed_mode_valid());
}

// Pending requests keep routing input through the confirmed Manual or Velocity mode.
TEST_F(RealDriveTest, RoutesInputThroughConfirmedModeDuringReadinessChecks)
{
  ASSERT_EQ(request("MANUAL"), std::optional<bool>(true));
  backend_->request_mode("VELOCITY");
  send(0.5F, 1.0F, false);
  EXPECT_EQ(received_, std::vector<double>({1, 1, 2, 2}));
  ASSERT_FALSE(backend_->take_mode_result().has_value());
  send(0.5F, 1.0F, false);
  EXPECT_EQ(received_, std::vector<double>({1, 1, 2, 2}));
  std::optional<bool> result;
  ASSERT_TRUE(wait([&] { result = backend_->take_mode_result(); return result.has_value(); }, 5s));
  ASSERT_EQ(result, std::optional<bool>(true));

  backend_->request_mode("MANUAL");
  sensor_msgs::msg::Joy joy; joy.axes = {0.0F, -1.0F, 0, 0, 0, 0};
  auto count = velocity_count_;
  backend_->on_joy(joy);
  ASSERT_TRUE(wait([&] { return velocity_count_ > count; }, 1s));
  EXPECT_NEAR(velocity_.twist.linear.x, 0.2, 1e-9);
  ASSERT_FALSE(backend_->take_mode_result().has_value());
  count = velocity_count_;
  backend_->on_joy(joy);
  ASSERT_TRUE(wait([&] { return velocity_count_ > count; }, 1s));
  EXPECT_NEAR(velocity_.twist.linear.x, 0.2, 1e-9);
  ASSERT_TRUE(wait([&] { result = backend_->take_mode_result(); return result.has_value(); }, 5s));
  ASSERT_EQ(result, std::optional<bool>(true));
  send(0.5F, 1.0F, false);
  EXPECT_EQ(received_, std::vector<double>({1, 1, 2, 2}));
}

// A failed handoff resumes the verified previous controller; an unknown owner blocks input.
TEST_F(RealDriveTest, ResumesAfterFailedHandoffOnlyWhenOwnershipIsKnown)
{
  ASSERT_EQ(request("MANUAL"), std::optional<bool>(true));
  switch_ok_ = false;
  EXPECT_EQ(request("VELOCITY"), std::optional<bool>(false));
  send(0.5F, 1.0F, false);
  EXPECT_EQ(received_, std::vector<double>({1, 1, 2, 2}));

  fail_after_apply_ = true;
  EXPECT_EQ(request("VELOCITY"), std::optional<bool>(false));
  EXPECT_FALSE(backend_->confirmed_mode_valid());
  executor_.spin_some();
  const auto count = command_count_;
  sensor_msgs::msg::Joy joy; joy.axes = {0, 0, 0, 0, 0.5F, 1.0F};
  backend_->on_joy(joy);
  EXPECT_FALSE(wait([&] { return command_count_ > count; }, 200ms));
}

// Joystick input is suspended while a controller switch is awaiting verification.
TEST_F(RealDriveTest, PausesInputDuringControllerSwitch)
{
  ASSERT_EQ(request("MANUAL"), std::optional<bool>(true));
  const auto previous_switches = switch_calls_;
  backend_->request_mode("VELOCITY");
  ASSERT_TRUE(wait([&] {
    backend_->take_mode_result();
    return switch_calls_ > previous_switches;
  }, 3s));
  ASSERT_TRUE(wait([&] {
    return received_ == std::vector<double>({0, 0, 0, 0});
  }, 1s));
  const auto count = command_count_;
  sensor_msgs::msg::Joy joy; joy.axes = {0, 0, 0, 0, 0.5F, 1.0F};
  backend_->on_joy(joy);
  EXPECT_FALSE(wait([&] { return command_count_ > count; }, 200ms));
  std::optional<bool> result;
  ASSERT_TRUE(wait([&] { result = backend_->take_mode_result(); return result.has_value(); }, 5s));
  EXPECT_EQ(result, std::optional<bool>(true));
}

// An inactive drivetrain clears FMA confirmation, blocks input and can recover on a later request.
TEST_F(RealDriveTest, ClearsConfirmationWhenHardwareIsInactiveAndRecovers)
{
  auto node = rover::make_rover_node(std::move(backend_));
  executor_.add_node(node);
  auto modes = driver_->create_publisher<std_msgs::msg::String>("/fma/drive/request", 10);
  auto joy = driver_->create_publisher<sensor_msgs::msg::Joy>("/drive/joy", 10);
  telemetry_interfaces::msg::FmaState latest;
  auto subscription = driver_->create_subscription<telemetry_interfaces::msg::FmaState>("/fma/state",
    rclcpp::QoS(1).reliable().transient_local(),
    [&latest](telemetry_interfaces::msg::FmaState::SharedPtr state) { latest = *state; });
  ASSERT_TRUE(wait([&] { return modes->get_subscription_count() > 0 && joy->get_subscription_count() > 0 && subscription->get_publisher_count() > 0; }, 2s));
  std_msgs::msg::String mode; mode.data = "MANUAL"; modes->publish(mode);
  ASSERT_TRUE(wait([&] { return latest.drive.confirmed == "MANUAL"; }, 3s));
  executor_.spin_some();
  const auto before_stop = command_count_;
  hardware_active_ = false;
  mode.data = "VELOCITY"; modes->publish(mode);
  ASSERT_TRUE(wait([&] { return latest.drive.rejected == "VELOCITY"; }, 3s));
  EXPECT_TRUE(latest.drive.confirmed.empty());
  ASSERT_TRUE(wait([&] { return command_count_ > before_stop && received_ == std::vector<double>({0, 0, 0, 0}); }, 1s));
  const auto count = command_count_;
  sensor_msgs::msg::Joy input; input.axes = {0, 0, 0, 0, 0.5F, 1.0F}; input.buttons = {0, 0, 0, 0};
  joy->publish(input);
  EXPECT_FALSE(wait([&] { return command_count_ > count; }, 250ms));
  hardware_active_ = true;
  mode.data = "MANUAL"; modes->publish(mode);
  ASSERT_TRUE(wait([&] { return latest.drive.confirmed == "MANUAL"; }, 3s));
  joy->publish(input);
  ASSERT_TRUE(wait([&] { return command_count_ > count; }, 1s));
  EXPECT_EQ(received_, std::vector<double>({1, 1, 2, 2}));
  executor_.remove_node(node);
}

// Hardware loss after a switch also invalidates the previous mode rather than restoring it.
TEST_F(RealDriveTest, InvalidatesConfirmationIfHardwareDropsAfterSwitch)
{
  ASSERT_EQ(request("MANUAL"), std::optional<bool>(true));
  drop_hardware_after_switch_ = true;
  EXPECT_EQ(request("VELOCITY"), std::optional<bool>(false));
  EXPECT_FALSE(backend_->confirmed_mode_valid());
  executor_.spin_some();
  const auto count = command_count_;
  sensor_msgs::msg::Joy joy; joy.axes = {0, 0, 0, 0, 0.5F, 1.0F};
  backend_->on_joy(joy);
  EXPECT_FALSE(wait([&] { return command_count_ > count; }, 200ms));
}
