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

TEST_F(EcamAggregationTest, RoverPublishesRecoverySnapshotsWithoutChanges)
{
  auto rover = std::make_shared<ecam_alerts::EcamAlertAggregator>("rover", 0.6, "test_periodic_rover");
  auto observer_node = std::make_shared<rclcpp::Node>("test_periodic_observer");
  ecam_alerts::EcamAlertSource source(*observer_node, "rover");
  int count = 0;
  auto observer = observer_node->create_subscription<telemetry_interfaces::msg::EcamAlerts>(
    ecam_alerts::kCombinedTopic, ecam_alerts::combined_qos(),
    [&count](telemetry_interfaces::msg::EcamAlerts::SharedPtr message) { if (message->authority == "rover") ++count; });
  executor_.add_node(rover);
  executor_.add_node(observer_node);
  EXPECT_TRUE(wait_for([&count] { return count >= 2; }, 3s));
  executor_.remove_node(rover);
  executor_.remove_node(observer_node);
}

TEST_F(EcamAggregationTest, RoverDoesNotPublishAnEmptySnapshotBeforeAnySource)
{
  auto rover = std::make_shared<ecam_alerts::EcamAlertAggregator>("rover", 0.6, "test_empty_rover");
  auto observer_node = std::make_shared<rclcpp::Node>("test_empty_observer");
  int count = 0;
  auto observer = observer_node->create_subscription<telemetry_interfaces::msg::EcamAlerts>(
    ecam_alerts::kCombinedTopic, ecam_alerts::combined_qos(),
    [&count](telemetry_interfaces::msg::EcamAlerts::SharedPtr) { ++count; });
  executor_.add_node(rover);
  executor_.add_node(observer_node);
  spin_for(1200ms);
  EXPECT_EQ(count, 0);
  executor_.remove_node(rover);
  executor_.remove_node(observer_node);
}

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
  ecam_alerts::Reporter subsystem(*heartbeat_node, "base-test", "basestation");
  subsystem.raise("BASE_FAULT");
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
      return has_code(message, "basestation", "basestation", ecam_alerts::kRoverHeartbeatLost) &&
        has_code(message, "basestation", "basestation", "BASE_FAULT");
    });
  }, 1s));

  heartbeat_timer->reset();
  ASSERT_TRUE(wait_for([&observed] {
    for (auto it = observed.rbegin(); it != observed.rend(); ++it) {
      const auto & message = *it;
      if (message.authority != "basestation") {
        continue;
      }
      for (const auto & snapshot : message.sources) {
        if (snapshot.source == "basestation") {
          return std::find(snapshot.active_codes.begin(), snapshot.active_codes.end(),
                   ecam_alerts::kRoverHeartbeatLost) == snapshot.active_codes.end() &&
            std::find(snapshot.active_codes.begin(), snapshot.active_codes.end(), "BASE_FAULT") != snapshot.active_codes.end();
        }
      }
    }
    return false;
  }, 1s));
  executor_.remove_node(base);
  executor_.remove_node(heartbeat_node);
}

TEST_F(EcamAggregationTest, BaseStationReportersShareOneSourceAndStaySeparateFromRover)
{
  auto base = std::make_shared<ecam_alerts::EcamAlertAggregator>("basestation", 3.0, "test_base_reporters");
  auto node = std::make_shared<rclcpp::Node>("test_subsystem_reporters");
  ecam_alerts::RoverAlertOwner rover_owner(*node);
  ecam_alerts::Reporter first(*node, "first", "basestation");
  ecam_alerts::Reporter second(*node, "second", "basestation");
  ecam_alerts::Reporter rover(*node, "rover-test");
  std::vector<std::string> base_codes, rover_codes;
  auto subscription = node->create_subscription<telemetry_interfaces::msg::EcamAlertSourceSnapshot>(
    ecam_alerts::kSourceTopic, rclcpp::QoS(20).reliable().transient_local(),
    [&](const telemetry_interfaces::msg::EcamAlertSourceSnapshot & message) {
      if (message.source == "basestation") base_codes = message.active_codes;
      if (message.source == "rover") rover_codes = message.active_codes;
    });
  auto has = [](const auto & codes, const char * code) {
    return std::find(codes.begin(), codes.end(), code) != codes.end();
  };
  executor_.add_node(base);
  executor_.add_node(node);
  first.raise("SHARED_FAULT");
  second.raise("SHARED_FAULT");
  second.raise("BASE_FAULT");
  rover.raise("ROVER_FAULT");
  ASSERT_TRUE(wait_for([&] {
    return has(base_codes, "SHARED_FAULT") && has(base_codes, "BASE_FAULT") &&
      has(rover_codes, "ROVER_FAULT");
  }, 2s));
  EXPECT_FALSE(has(base_codes, "ROVER_FAULT"));
  EXPECT_FALSE(has(rover_codes, "BASE_FAULT"));
  first.clear("SHARED_FAULT");
  second.clear("BASE_FAULT");
  ASSERT_TRUE(wait_for([&] { return !has(base_codes, "BASE_FAULT"); }, 2s));
  EXPECT_TRUE(has(base_codes, "SHARED_FAULT"));
  second.clear("SHARED_FAULT");
  ASSERT_TRUE(wait_for([&] { return !has(base_codes, "SHARED_FAULT"); }, 2s));
  executor_.remove_node(base);
  executor_.remove_node(node);
}

}  // namespace
