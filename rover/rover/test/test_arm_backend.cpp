#include <chrono>
#include <thread>
#include <gtest/gtest.h>
#include <rclcpp/rclcpp.hpp>
#include <rclcpp_action/rclcpp_action.hpp>
#include <control_msgs/action/follow_joint_trajectory.hpp>
#include <std_msgs/msg/string.hpp>
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
  options.parameter_overrides({rclcpp::Parameter("arm_backend", "real")});
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
  EXPECT_EQ(client->count_publishers("/arm/direct_drive"), 0u);
  executor.remove_node(client); executor.remove_node(node);
}
