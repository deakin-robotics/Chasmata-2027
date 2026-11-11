#include <chrono>
#include <thread>
#include <gtest/gtest.h>
#include <rclcpp/rclcpp.hpp>
#include <rclcpp_action/rclcpp_action.hpp>
#include <control_msgs/action/follow_joint_trajectory.hpp>
#include <std_msgs/msg/string.hpp>
#include <sensor_msgs/msg/joy.hpp>
#include <dcr_arm_driver/msg/direct_drive.hpp>
#include <telemetry_interfaces/msg/arm_control_status.hpp>
#include <map>
#include <telemetry_interfaces/msg/fma_state.hpp>
#include "rover/rover_node.hpp"

using namespace std::chrono_literals;

class ArmBackendSelection : public ::testing::Test
{
protected:
  static void SetUpTestSuite() { int argc = 0; rclcpp::init(argc, nullptr); }
  static void TearDownTestSuite() { rclcpp::shutdown(); }
};

TEST_F(ArmBackendSelection, MockSelectionCreatesSimulatorEndpoints)
{
  rclcpp::NodeOptions options;
  options.parameter_overrides({rclcpp::Parameter("arm_backend", "mock")});
  auto node = rover::make_rover_node(options);
  auto client = std::make_shared<rclcpp::Node>("mock_backend_test_client");
  auto action = rclcpp_action::create_client<control_msgs::action::FollowJointTrajectory>(client,
    "/arm_controller/follow_joint_trajectory");
  EXPECT_TRUE(action->wait_for_action_server(2s));
  EXPECT_EQ(client->count_publishers("/arm/joint_states"), 1u);
}

TEST_F(ArmBackendSelection, InvalidSelectionFails)
{
  rclcpp::NodeOptions options;
  options.parameter_overrides({rclcpp::Parameter("arm_backend", "invalid")});
  EXPECT_THROW(rover::make_rover_node(options), std::invalid_argument);
}

TEST_F(ArmBackendSelection, RealBackendRejectsRequestsWithoutSimulatorEndpoints)
{
  rclcpp::NodeOptions options;
  options.parameter_overrides({rclcpp::Parameter("arm_backend", "real"),
    rclcpp::Parameter("arm_manual_speed_rpm", std::vector<double>(6, 1.0))});
  auto node = rover::make_rover_node(options);
  auto client = std::make_shared<rclcpp::Node>("arm_backend_test_client");
  auto request = client->create_publisher<std_msgs::msg::String>("/fma/arm/request", 10);
  telemetry_interfaces::msg::FmaState latest;
  bool rejected = false;
  auto sub = client->create_subscription<telemetry_interfaces::msg::FmaState>("/fma/state",
    rclcpp::QoS(1).reliable().transient_local(), [&](const telemetry_interfaces::msg::FmaState & msg) {
      latest = msg;
      if (msg.arm.rejected == "MANUAL") rejected = true;
    });
  auto action = rclcpp_action::create_client<control_msgs::action::FollowJointTrajectory>(client,
    "/arm_controller/follow_joint_trajectory");
  rclcpp::executors::SingleThreadedExecutor executor;
  executor.add_node(node); executor.add_node(client);
  auto deadline = std::chrono::steady_clock::now() + 3s;
  std_msgs::msg::String mode; mode.data = "MANUAL";
  while (request->get_subscription_count() == 0 && std::chrono::steady_clock::now() < deadline) {
    executor.spin_some(); std::this_thread::sleep_for(20ms);
  }
  request->publish(mode);
  while (!rejected && std::chrono::steady_clock::now() < deadline) {
    executor.spin_some(); std::this_thread::sleep_for(20ms);
  }
  EXPECT_TRUE(rejected);
  EXPECT_TRUE(latest.arm.confirmed.empty());
  EXPECT_EQ(client->count_publishers("/arm/joint_states"), 0u);
  EXPECT_FALSE(action->action_server_is_ready());
  EXPECT_EQ(client->count_publishers("/arm/direct_drive"), 1u);
  executor.remove_node(client); executor.remove_node(node);
}

TEST_F(ArmBackendSelection, ManualRequiresAcknowledgementsAndStopsStaleInput)
{
  using Command = dcr_arm_driver::msg::DirectDrive;
  using Status = telemetry_interfaces::msg::ArmControlStatus;
  rclcpp::NodeOptions options;
  options.parameter_overrides({rclcpp::Parameter("arm_backend", "real"),
    rclcpp::Parameter("arm_manual_speed_rpm", std::vector<double>{1., 2., 3., 4., 5., 6.})});
  auto node = rover::make_rover_node(options);
  auto driver = std::make_shared<rclcpp::Node>("fake_arm_driver");
  auto request = driver->create_publisher<std_msgs::msg::String>("/fma/arm/request", 10);
  auto joy = driver->create_publisher<sensor_msgs::msg::Joy>("/arm/joy", 10);
  auto status_pub = driver->create_publisher<Status>("/arm/control/status", 10);
  Status status;
  status.direct_ready = true;
  status.joint_names = {"base_joint", "shoulder_joint", "elbow_joint", "yaw_joint", "pitch_joint", "roll_joint"};
  status.joint_can_ids = {9, 8, 7, 6, 5, 4};
  status.joint_max_velocity_rpm = {10, 10, 10, 10, 10, 10};
  status.direct_request_ids = {0, 0, 0, 0, 0, 0};
  std::map<uint32_t, Command> commands;
  auto command_sub = driver->create_subscription<Command>("/arm/direct_drive", 32,
    [&](const Command & cmd) { commands[cmd.id] = cmd; });
  telemetry_interfaces::msg::FmaState latest;
  auto fma_sub = driver->create_subscription<telemetry_interfaces::msg::FmaState>("/fma/state",
    rclcpp::QoS(1).reliable().transient_local(), [&](const telemetry_interfaces::msg::FmaState & state) { latest = state; });
  auto timer = driver->create_wall_timer(20ms, [&] { status_pub->publish(status); });
  rclcpp::executors::SingleThreadedExecutor executor;
  executor.add_node(node); executor.add_node(driver);
  const auto spin = [&](std::chrono::milliseconds time) {
    const auto end = std::chrono::steady_clock::now() + time;
    while (std::chrono::steady_clock::now() < end) { executor.spin_some(); std::this_thread::sleep_for(5ms); }
  };
  spin(200ms);
  std_msgs::msg::String mode; mode.data = "MANUAL"; request->publish(mode); spin(300ms);
  EXPECT_EQ(latest.arm.pending, "MANUAL");
  EXPECT_TRUE(latest.arm.confirmed.empty());
  ASSERT_EQ(commands.size(), 6u);
  const auto token = commands.begin()->second.request_id;
  ASSERT_NE(token, 0u);
  for (const auto & entry : commands) EXPECT_DOUBLE_EQ(entry.second.value, 0.0);
  for (size_t i = 0; i < 5; ++i) status.direct_request_ids[i] = token;
  spin(200ms); EXPECT_TRUE(latest.arm.confirmed.empty());
  status.direct_request_ids[5] = token;
  spin(200ms); EXPECT_EQ(latest.arm.confirmed, "MANUAL");
  sensor_msgs::msg::Joy input;
  input.axes = {1, -1, 0, 0, 0.5, 0, 1, -1, 0.25, 0.75};
  input.buttons = std::vector<int32_t>(12, 0);
  joy->publish(input); spin(100ms);
  EXPECT_DOUBLE_EQ(commands[9].value, 1.0);
  EXPECT_DOUBLE_EQ(commands[8].value, -2.0);
  EXPECT_DOUBLE_EQ(commands[7].value, 1.5);
  EXPECT_DOUBLE_EQ(commands[6].value, 4.0);
  EXPECT_DOUBLE_EQ(commands[5].value, -5.0);
  EXPECT_DOUBLE_EQ(commands[4].value, 3.0);
  input.buttons[4] = 1; joy->publish(input); spin(100ms);
  EXPECT_DOUBLE_EQ(commands[7].value, 0.0);
  spin(350ms);
  for (const auto & entry : commands) EXPECT_DOUBLE_EQ(entry.second.value, 0.0);
  mode.data = "POSITION"; request->publish(mode); spin(200ms);
  EXPECT_EQ(latest.arm.rejected, "POSITION");
  EXPECT_EQ(latest.arm.confirmed, "MANUAL");
  timer.reset(); spin(500ms); EXPECT_TRUE(latest.arm.confirmed.empty());
  executor.remove_node(driver); executor.remove_node(node);
}

TEST_F(ArmBackendSelection, InvalidManualSpeedFails)
{
  rclcpp::NodeOptions options;
  options.parameter_overrides({rclcpp::Parameter("arm_backend", "real"),
    rclcpp::Parameter("arm_manual_speed_rpm", std::vector<double>{1., 1., 0., 1., 1., 1.})});
  EXPECT_THROW(rover::make_rover_node(options), std::invalid_argument);
}
