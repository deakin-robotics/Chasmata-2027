#include <algorithm>
#include <chrono>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include <gtest/gtest.h>
#include <rclcpp/executors/single_threaded_executor.hpp>

#include "ecam_alerts/aggregator.hpp"

namespace
{
using namespace std::chrono_literals;

class EcamAggregationTest : public ::testing::Test
{
protected:
  static void SetUpTestSuite()
  {
    int argc = 0;
    rclcpp::init(argc, nullptr);
  }

  static void TearDownTestSuite()
  {
    rclcpp::shutdown();
  }

  bool wait_for(const std::function<bool()> & predicate, std::chrono::milliseconds timeout)
  {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    while (std::chrono::steady_clock::now() < deadline) {
      executor_.spin_some();
      if (predicate()) {
        return true;
      }
      std::this_thread::sleep_for(10ms);
    }
    executor_.spin_some();
    return predicate();
  }

  void spin_for(std::chrono::milliseconds duration)
  {
    const auto deadline = std::chrono::steady_clock::now() + duration;
    while (std::chrono::steady_clock::now() < deadline) {
      executor_.spin_some();
      std::this_thread::sleep_for(10ms);
    }
  }

  static bool has_code(const telemetry_interfaces::msg::EcamAlerts & message,
    const std::string & authority, const std::string & source, const std::string & code)
  {
    if (message.authority != authority) {
      return false;
    }
    for (const auto & snapshot : message.sources) {
      if (snapshot.source == source) {
        return std::find(snapshot.active_codes.begin(), snapshot.active_codes.end(), code) !=
               snapshot.active_codes.end();
      }
    }
    return false;
  }

  rclcpp::executors::SingleThreadedExecutor executor_;
};

TEST_F(EcamAggregationTest, RoverPrimaryFailsOverAndHandsBackReflectedSources)
{
  auto rover = std::make_shared<ecam_alerts::EcamAlertAggregator>("rover", 0.6, "test_rover");
  auto base = std::make_shared<ecam_alerts::EcamAlertAggregator>("basestation", 0.6, "test_base");
  auto source_node = std::make_shared<rclcpp::Node>("test_ecam_source");
  auto observer_node = std::make_shared<rclcpp::Node>("test_ecam_observer");
  ecam_alerts::EcamAlertSource driver(*source_node, "driver");
  ecam_alerts::EcamAlertSource arm(*source_node, "arm");
  auto heartbeat = source_node->create_publisher<std_msgs::msg::Empty>(
    ecam_alerts::kRoverHeartbeatTopic, rclcpp::QoS(1));
  auto heartbeat_timer = source_node->create_wall_timer(100ms, [&heartbeat]() {
    heartbeat->publish(std_msgs::msg::Empty{});
  });
  std::vector<telemetry_interfaces::msg::EcamAlerts> observed;
  auto observer = observer_node->create_subscription<telemetry_interfaces::msg::EcamAlerts>(
    ecam_alerts::kCombinedTopic, ecam_alerts::combined_qos(),
    [&observed](telemetry_interfaces::msg::EcamAlerts::SharedPtr message) { observed.push_back(*message); });
  executor_.add_node(rover);
  executor_.add_node(base);
  executor_.add_node(source_node);
  executor_.add_node(observer_node);

  // Establish the heartbeat and transient-local subscriptions before testing failover.
  spin_for(300ms);

  driver.raise_alert("TEST_DRIVER_ALERT");
  ASSERT_TRUE(wait_for([&observed] {
    return std::any_of(observed.rbegin(), observed.rend(), [](const auto & message) {
      return has_code(message, "rover", "driver", "TEST_DRIVER_ALERT");
    });
  }, 1s));

  // Let BaseStation consume Rover's combined snapshot before Rover is withdrawn.
  spin_for(200ms);

  heartbeat_timer->cancel();
  executor_.remove_node(rover);
  rover.reset();
  ASSERT_TRUE(wait_for([&observed] {
    return std::any_of(observed.rbegin(), observed.rend(), [](const auto & message) {
      return has_code(message, "basestation", "basestation", ecam_alerts::kRoverHeartbeatLost);
    });
  }, 1s));
  // Reassert the complete source state after authority transfer, as a live source does.
  driver.publish_snapshot();
  ASSERT_TRUE(wait_for([&observed] {
    return std::any_of(observed.rbegin(), observed.rend(), [](const auto & message) {
      return has_code(message, "basestation", "driver", "TEST_DRIVER_ALERT");
    });
  }, 1s));
  arm.raise_alert("TEST_ARM_ALERT");
  ASSERT_TRUE(wait_for([&observed] {
    return std::any_of(observed.rbegin(), observed.rend(), [](const auto & message) {
      return has_code(message, "basestation", "arm", "TEST_ARM_ALERT");
    });
  }, 1s));

  heartbeat_timer->reset();
  spin_for(100ms);
  rover = std::make_shared<ecam_alerts::EcamAlertAggregator>("rover", 0.25, "test_rover_returned");
  executor_.add_node(rover);
  ASSERT_TRUE(wait_for([&observed] {
    const bool driver_reflected = std::any_of(observed.rbegin(), observed.rend(), [](const auto & message) {
      return has_code(message, "rover", "driver", "TEST_DRIVER_ALERT");
    });
    const bool arm_reflected = std::any_of(observed.rbegin(), observed.rend(), [](const auto & message) {
      return has_code(message, "rover", "arm", "TEST_ARM_ALERT");
    });
    return driver_reflected && arm_reflected;
  }, 2s));

  executor_.remove_node(rover);
  executor_.remove_node(base);
  executor_.remove_node(source_node);
  executor_.remove_node(observer_node);
}

TEST_F(EcamAggregationTest, BaseStationRaisesAndClearsHeartbeatLost)
{
  auto base = std::make_shared<ecam_alerts::EcamAlertAggregator>("basestation", 0.2, "test_base_heartbeat");
  auto heartbeat_node = std::make_shared<rclcpp::Node>("test_heartbeat_source");
  auto heartbeat = heartbeat_node->create_publisher<std_msgs::msg::Empty>(
    ecam_alerts::kRoverHeartbeatTopic, rclcpp::QoS(1));
  auto heartbeat_timer = heartbeat_node->create_wall_timer(50ms, [&heartbeat]() {
    heartbeat->publish(std_msgs::msg::Empty{});
  });
  std::vector<telemetry_interfaces::msg::EcamAlerts> observed;
  auto observer = heartbeat_node->create_subscription<telemetry_interfaces::msg::EcamAlerts>(
    ecam_alerts::kCombinedTopic, ecam_alerts::combined_qos(),
    [&observed](telemetry_interfaces::msg::EcamAlerts::SharedPtr message) { observed.push_back(*message); });
  executor_.add_node(base);
  executor_.add_node(heartbeat_node);
  spin_for(150ms);

  heartbeat_timer->cancel();
  ASSERT_TRUE(wait_for([&observed] {
    return std::any_of(observed.rbegin(), observed.rend(), [](const auto & message) {
      return has_code(message, "basestation", "basestation", ecam_alerts::kRoverHeartbeatLost);
    });
  }, 1s));

  heartbeat_timer->reset();
  ASSERT_TRUE(wait_for([&observed] {
    return std::any_of(observed.rbegin(), observed.rend(), [](const auto & message) {
      if (message.authority != "basestation") {
        return false;
      }
      for (const auto & snapshot : message.sources) {
        if (snapshot.source == "basestation") {
          return std::find(snapshot.active_codes.begin(), snapshot.active_codes.end(),
                   ecam_alerts::kRoverHeartbeatLost) == snapshot.active_codes.end();
        }
      }
      return false;
    });
  }, 1s));
  executor_.remove_node(base);
  executor_.remove_node(heartbeat_node);
}

}  // namespace
