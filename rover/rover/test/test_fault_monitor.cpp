#include <algorithm>
#include <chrono>
#include <memory>
#include <thread>
#include <gtest/gtest.h>
#include <rclcpp/rclcpp.hpp>
#include "../src/telemetry/fault_monitor.hpp"

using namespace std::chrono_literals;

TEST(FaultMonitor, PublishesAndClearsOnlyTheAffectedFaults)
{
  int argc = 0;
  rclcpp::init(argc, nullptr);
  auto node = std::make_shared<rclcpp::Node>("fault_monitor_test");
  rover::telemetry::FaultMonitor monitor(*node, true, true, false, true, true);
  auto drive = node->create_publisher<std_msgs::msg::Int32MultiArray>("/telemetry/drive/fault_raw", rclcpp::QoS(4).reliable().transient_local());
  auto arm = node->create_publisher<arm_interfaces::msg::MotorStat2>("/telemetry/arm/motor_detail", 10);
  auto planner = node->create_publisher<telemetry_interfaces::msg::ArmMoveItStatus>("/arm/moveit/status", 10);
  auto communication = node->create_publisher<std_msgs::msg::Bool>("/drivetrain/communication_fault", rclcpp::QoS(1).reliable().transient_local());
  auto safety = node->create_publisher<std_msgs::msg::Bool>("/drivetrain/safety_fault", rclcpp::QoS(1).reliable().transient_local());
  auto estop = node->create_publisher<std_msgs::msg::Bool>("/estop", 10);
  auto arm_status = node->create_publisher<telemetry_interfaces::msg::ArmControlStatus>("/telemetry/arm/status", 10);
  auto arm_joints = node->create_publisher<sensor_msgs::msg::JointState>("/telemetry/arm/joint_states", 10);
  auto can = node->create_publisher<can_msgs::msg::Frame>("/socketcan_bridge/rx", 100);
  telemetry_interfaces::msg::EcamAlertSourceSnapshot snapshot;
  auto alerts = node->create_subscription<telemetry_interfaces::msg::EcamAlertSourceSnapshot>(
    "/ecam/alerts/source", ecam_alerts::snapshot_qos(),
    [&](const telemetry_interfaces::msg::EcamAlertSourceSnapshot & message) { if (message.source == "rover") snapshot = message; });
  auto has = [&](const std::string & code) { return std::find(snapshot.active_codes.begin(), snapshot.active_codes.end(), code) != snapshot.active_codes.end(); };
  auto wait = [&](const auto & publish, const auto & predicate) {
    const auto end = std::chrono::steady_clock::now() + 3s;
    while (!predicate() && std::chrono::steady_clock::now() < end) {
      publish(); rclcpp::spin_some(node); std::this_thread::sleep_for(20ms);
    }
    return predicate();
  };
  std_msgs::msg::Int32MultiArray first; first.data = {0, 1};
  ASSERT_TRUE(wait([&] { drive->publish(first); }, [&] { return has("DRIVE_FL_MOTOR_FAULT") && has("DRIVE_FL_OVERCURRENT") && has("DRIVE_DRIVETRAIN_FAULT"); }));
  std_msgs::msg::Int32MultiArray second; second.data = {1, 2};
  ASSERT_TRUE(wait([&] { drive->publish(second); }, [&] { return has("DRIVE_RL_MOTOR_FAULT") && has("DRIVE_RL_OVERTEMPERATURE"); }));
  std_msgs::msg::Int32MultiArray unknown; unknown.data = {1, -1};
  for (int i = 0; i < 5; ++i) { drive->publish(unknown); rclcpp::spin_some(node); std::this_thread::sleep_for(20ms); }
  EXPECT_TRUE(has("DRIVE_RL_MOTOR_FAULT"));
  first.data[1] = 0;
  ASSERT_TRUE(wait([&] { drive->publish(first); }, [&] { return !has("DRIVE_FL_MOTOR_FAULT") && has("DRIVE_DRIVETRAIN_FAULT"); }));
  second.data[1] = 0;
  ASSERT_TRUE(wait([&] { drive->publish(second); }, [&] { return !has("DRIVE_DRIVETRAIN_FAULT"); }));
  arm_interfaces::msg::MotorStat2 motor; motor.id = 1; motor.fault_bits = 4;
  ASSERT_TRUE(wait([&] { arm->publish(motor); }, [&] { return has("ARM_JOINT_FAULT") && has("ARM_OVERTEMPERATURE"); }));
  motor.id = 2; motor.fault_bits = 1;
  for (int i = 0; i < 10; ++i) { arm->publish(motor); rclcpp::spin_some(node); std::this_thread::sleep_for(20ms); }
  motor.id = 1; motor.fault_bits = 0;
  ASSERT_TRUE(wait([&] { arm->publish(motor); }, [&] { return !has("ARM_OVERTEMPERATURE") && has("ARM_JOINT_FAULT"); }));
  motor.id = 2;
  ASSERT_TRUE(wait([&] { arm->publish(motor); }, [&] { return !has("ARM_JOINT_FAULT"); }));
  telemetry_interfaces::msg::ArmMoveItStatus state; state.state = "FAILED";
  ASSERT_TRUE(wait([&] { planner->publish(state); }, [&] { return has("ARM_POSITION_REQUEST_FAILED"); }));
  state.state = "SUCCEEDED";
  ASSERT_TRUE(wait([&] { planner->publish(state); }, [&] { return !has("ARM_POSITION_REQUEST_FAILED"); }));
  std_msgs::msg::Bool flag; flag.data = true;
  ASSERT_TRUE(wait([&] { safety->publish(flag); }, [&] { return has("DRIVE_DRIVETRAIN_FAULT"); }));
  ASSERT_TRUE(wait([&] { communication->publish(flag); }, [&] { return has("DRIVE_RS485_FAULT"); }));
  ASSERT_TRUE(wait([&] { estop->publish(flag); }, [&] { return has("SYSTEM_ESTOP_ACTIVE"); }));
  flag.data = false;
  ASSERT_TRUE(wait([&] { safety->publish(flag); }, [&] { return !has("DRIVE_DRIVETRAIN_FAULT"); }));
  ASSERT_TRUE(wait([&] { communication->publish(flag); }, [&] { return !has("DRIVE_RS485_FAULT"); }));
  ASSERT_TRUE(wait([&] { estop->publish(flag); }, [&] { return !has("SYSTEM_ESTOP_ACTIVE"); }));
  telemetry_interfaces::msg::ArmControlStatus status;
  status.reason = "latched: CAN error frame"; status.motion_inhibited = true;
  ASSERT_TRUE(wait([&] { arm_status->publish(status); }, [&] { return has("ARM_CAN_FAULT") && has("ARM_CONTROL_FAULT"); }));
  status.reason = "ready"; status.hardware_active = true; status.feedback_fresh = true; status.motion_inhibited = false;
  ASSERT_TRUE(wait([&] { arm_status->publish(status); }, [&] { return !has("ARM_CAN_FAULT") && !has("ARM_CONTROL_FAULT"); }));
  can_msgs::msg::Frame can_error; can_error.is_error = true;
  ASSERT_TRUE(wait([&] { can->publish(can_error); }, [&] { return has("ARM_CAN_FAULT"); }));
  status.motion_inhibited = true;
  for (int i = 0; i < 5; ++i) { arm_status->publish(status); rclcpp::spin_some(node); std::this_thread::sleep_for(20ms); }
  status.motion_inhibited = false;
  ASSERT_TRUE(wait([&] { arm_status->publish(status); }, [&] { return !has("ARM_CAN_FAULT"); }));
  sensor_msgs::msg::JointState joints; joints.name = {"base_joint"}; joints.position = {0.0};
  for (int i = 0; i < 10; ++i) { arm_status->publish(status); arm_joints->publish(joints); rclcpp::spin_some(node); std::this_thread::sleep_for(20ms); }
  ASSERT_TRUE(wait([&] { arm_status->publish(status); arm_joints->publish(joints); }, [&] { return !has("ARM_TELEMETRY_UNAVAILABLE"); }));
  status.feedback_fresh = false;
  ASSERT_TRUE(wait([&] { arm_status->publish(status); arm_joints->publish(joints); }, [&] { return has("ARM_TELEMETRY_UNAVAILABLE"); }));
  status.feedback_fresh = true;
  ASSERT_TRUE(wait([&] { arm_status->publish(status); arm_joints->publish(joints); }, [&] { return !has("ARM_TELEMETRY_UNAVAILABLE"); }));
  rclcpp::shutdown();
}

TEST(FaultMonitor, MissingEstopHeartbeatIsUnavailableAndFreshStatusRecovers)
{
  int argc = 0;
  rclcpp::init(argc, nullptr);
  auto node = std::make_shared<rclcpp::Node>("estop_fault_monitor_test");
  rover::telemetry::FaultMonitor monitor(*node, false, false, true);
  auto estop = node->create_publisher<std_msgs::msg::Bool>("/estop", 10);
  telemetry_interfaces::msg::EcamAlertSourceSnapshot snapshot;
  auto alerts = node->create_subscription<telemetry_interfaces::msg::EcamAlertSourceSnapshot>(
    "/ecam/alerts/source", ecam_alerts::snapshot_qos(),
    [&](const telemetry_interfaces::msg::EcamAlertSourceSnapshot & message) { snapshot = message; });
  auto has = [&] { return std::find(snapshot.active_codes.begin(), snapshot.active_codes.end(), "SYSTEM_ESTOP_UNAVAILABLE") != snapshot.active_codes.end(); };
  const auto wait_until = [&](const auto & predicate, std::chrono::milliseconds timeout) {
    const auto end = std::chrono::steady_clock::now() + timeout;
    while (!predicate() && std::chrono::steady_clock::now() < end) { rclcpp::spin_some(node); std::this_thread::sleep_for(10ms); }
    return predicate();
  };
  ASSERT_TRUE(wait_until(has, 2s));
  std_msgs::msg::Bool clear; clear.data = false;
  const auto end = std::chrono::steady_clock::now() + 2s;
  while (has() && std::chrono::steady_clock::now() < end) {
    estop->publish(clear); rclcpp::spin_some(node); std::this_thread::sleep_for(10ms);
  }
  ASSERT_FALSE(has());
  EXPECT_TRUE(wait_until(has, 2s));
  rclcpp::shutdown();
}
