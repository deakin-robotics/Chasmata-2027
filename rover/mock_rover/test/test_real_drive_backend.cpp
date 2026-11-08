#include <chrono>
#include <functional>
#include <thread>

#include <gtest/gtest.h>
#include <std_msgs/msg/string.hpp>
#include <telemetry_interfaces/msg/fma_state.hpp>
#include "mock_rover/mock_rover_node.hpp"
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
        EXPECT_EQ(request->activate_controllers, std::vector<std::string>({"wheel_velocity_controller"}));
        EXPECT_EQ(request->deactivate_controllers, std::vector<std::string>({"diff_drive_controller"}));
        response->ok = switch_ok_;
        if (switch_ok_) manual_active_ = true;
      });
    commands_ = driver_->create_subscription<std_msgs::msg::Float64MultiArray>("/drivetrain/direct/wheel_speeds", 10,
      [this](std_msgs::msg::Float64MultiArray::SharedPtr message) { received_ = message->data; ++command_count_; });
    backend_ = std::make_unique<mock_rover::RealDriveBackend>(*rover_, 2.0);
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
  std::unique_ptr<mock_rover::RealDriveBackend> backend_;
  bool hardware_active_{true}, manual_active_{false}, switch_ok_{true};
  size_t command_count_{0};
  std::vector<double> received_;
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
  EXPECT_EQ(request("VELOCITY"), std::optional<bool>(false));
  EXPECT_EQ(request("MANAGED"), std::optional<bool>(false));
}

// Real driving cannot start without an explicitly configured positive speed limit.
TEST_F(RealDriveTest, RequiresWheelSpeedLimit)
{
  EXPECT_THROW(mock_rover::RealDriveBackend(*rover_, 0.0), std::invalid_argument);
}

// FMA confirms real Manual only after the controller handoff and retains it on rejection.
TEST_F(RealDriveTest, RoverFmaReflectsRealBackendHandoff)
{
  auto node = mock_rover::make_mock_rover_node(std::move(backend_));
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
  ASSERT_TRUE(wait([&] { return latest.drive.rejected == "VELOCITY"; }, 2s));
  EXPECT_EQ(latest.drive.confirmed, "MANUAL");
  executor_.remove_node(node);
}
