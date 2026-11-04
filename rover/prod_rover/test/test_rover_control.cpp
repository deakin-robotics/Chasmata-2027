#include <chrono>
#include <functional>
#include <memory>
#include <thread>
#include <vector>

#include <gtest/gtest.h>
#include <rclcpp/executors/single_threaded_executor.hpp>
#include <std_msgs/msg/empty.hpp>
#include <std_msgs/msg/string.hpp>
#include <telemetry_interfaces/msg/fma_state.hpp>

#include "prod_rover/rover_control_node.hpp"

namespace
{
using namespace std::chrono_literals;

class RoverControlTest : public ::testing::Test
{
protected:
  static void SetUpTestSuite() { int argc = 0; rclcpp::init(argc, nullptr); }
  static void TearDownTestSuite() { rclcpp::shutdown(); }
  void SetUp() override
  {
    control_ = prod_rover::make_rover_control_node();
    client_ = std::make_shared<rclcpp::Node>("rover_control_test_client");
    arm_request_ = client_->create_publisher<std_msgs::msg::String>("/fma/arm/request", 10);
    override_request_ = client_->create_publisher<std_msgs::msg::String>("/arm/override/request", 10);
    gimbal_request_ = client_->create_publisher<std_msgs::msg::String>("/fma/gimbal/request", 10);
    fma_ = client_->create_subscription<telemetry_interfaces::msg::FmaState>("/fma/state",
      rclcpp::QoS(1).reliable().transient_local(),
      [this](telemetry_interfaces::msg::FmaState::SharedPtr message) { states_.push_back(*message); });
    heartbeat_ = client_->create_subscription<std_msgs::msg::Empty>("/rover/heartbeat", 10,
      [this](std_msgs::msg::Empty::SharedPtr) { ++heartbeats_; });
    executor_.add_node(control_); executor_.add_node(client_);
    ASSERT_TRUE(wait_for([this] { return !states_.empty() && heartbeats_ > 0; }, 2s));
  }
  void TearDown() override { executor_.remove_node(client_); executor_.remove_node(control_); }
  bool wait_for(const std::function<bool()> & predicate, std::chrono::milliseconds timeout)
  {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    while (std::chrono::steady_clock::now() < deadline) { executor_.spin_some(); if (predicate()) return true; std::this_thread::sleep_for(10ms); }
    return predicate();
  }
  void publish(const rclcpp::Publisher<std_msgs::msg::String>::SharedPtr & publisher, const std::string & value)
  { std_msgs::msg::String message; message.data = value; publisher->publish(message); }
  const telemetry_interfaces::msg::FmaState & state() const { return states_.back(); }
  rclcpp::executors::SingleThreadedExecutor executor_;
  std::shared_ptr<rclcpp::Node> control_, client_;
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr arm_request_, override_request_, gimbal_request_;
  rclcpp::Subscription<telemetry_interfaces::msg::FmaState>::SharedPtr fma_;
  rclcpp::Subscription<std_msgs::msg::Empty>::SharedPtr heartbeat_;
  std::vector<telemetry_interfaces::msg::FmaState> states_; size_t heartbeats_{0};
};

TEST_F(RoverControlTest, AcknowledgesModesAndReportsFmaState)
{
  publish(arm_request_, "position");
  ASSERT_TRUE(wait_for([this] { return state().arm.pending == "POSITION"; }, 1s));
  ASSERT_TRUE(wait_for([this] { return state().arm.confirmed == "POSITION"; }, 1s));
  publish(arm_request_, "invalid");
  ASSERT_TRUE(wait_for([this] { return state().arm.rejected == "INVALID"; }, 1s));
}

TEST_F(RoverControlTest, AcknowledgesOverrideAndGimbalOwnership)
{
  publish(override_request_, "ENABLE");
  ASSERT_TRUE(wait_for([this] { return state().arm_override.pending == "ENABLE"; }, 1s));
  ASSERT_TRUE(wait_for([this] { return state().law == "DIRECT" && state().arm_override.state == "ACTIVE"; }, 1s));
  publish(gimbal_request_, "ARM OPS");
  ASSERT_TRUE(wait_for([this] { return state().gimbal_priority.confirmed == "ARM OPS"; }, 1s));
}
}  // namespace
