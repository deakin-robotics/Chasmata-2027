#include <chrono>
#include <memory>
#include <thread>
#include <gtest/gtest.h>
#include <rclcpp/rclcpp.hpp>
#include "../src/telemetry/drive/backend.hpp"
#include "../src/telemetry/arm/backend.hpp"
#include "../src/telemetry/recovery_snapshot.hpp"

using namespace std::chrono_literals;

TEST(TelemetryBackends, RealDriveForwardsActiveJointStates)
{
  int argc = 0;
  rclcpp::init(argc, nullptr);
  auto node = std::make_shared<rclcpp::Node>("drive_telemetry_test");
  rover::telemetry::drive::RealBackend backend(*node, 0.1, 0.5, [] { return std::string("MANUAL"); });
  auto input = node->create_publisher<sensor_msgs::msg::JointState>("/drivetrain/validated_joint_states", 10);
  sensor_msgs::msg::JointState received;
  auto output = node->create_subscription<sensor_msgs::msg::JointState>("/telemetry/drive/joint_states", 10,
    [&](const sensor_msgs::msg::JointState & msg) { received = msg; });
  auto command_input = node->create_publisher<std_msgs::msg::Float64MultiArray>("/drivetrain/wheel_velocity_controller/commands", 10);
  auto temperature_input = node->create_publisher<std_msgs::msg::Int32MultiArray>("/drivetrain/temperature_raw", 10);
  sensor_msgs::msg::JointState command_received;
  std_msgs::msg::Int32MultiArray temperature_received;
  auto command_output = node->create_subscription<sensor_msgs::msg::JointState>("/telemetry/drive/commands", 10,
    [&](const sensor_msgs::msg::JointState & msg) { command_received = msg; });
  auto temperature_output = node->create_subscription<std_msgs::msg::Int32MultiArray>("/telemetry/drive/temperature_raw", 10,
    [&](const std_msgs::msg::Int32MultiArray & msg) { temperature_received = msg; });
  sensor_msgs::msg::JointState sample;
  sample.name = {"front_left_wheel_joint"};
  sample.velocity = {1.25};
  const auto until = std::chrono::steady_clock::now() + 3s;
  std_msgs::msg::Float64MultiArray command; command.data = {1.0, 2.0, 3.0, 4.0};
  std_msgs::msg::Int32MultiArray temperature; temperature.data = {0, 42};
  while ((received.velocity.empty() || command_received.velocity.empty() || temperature_received.data.empty()) &&
      std::chrono::steady_clock::now() < until) {
    input->publish(sample);
    command_input->publish(command);
    temperature_input->publish(temperature);
    rclcpp::spin_some(node);
    std::this_thread::sleep_for(20ms);
  }
  ASSERT_EQ(received.velocity.size(), 1u);
  EXPECT_DOUBLE_EQ(received.velocity[0], 1.25);
  ASSERT_EQ(command_received.velocity.size(), 4u);
  EXPECT_DOUBLE_EQ(command_received.velocity[1], 2.0);
  ASSERT_EQ(temperature_received.data.size(), 2u);
  EXPECT_EQ(temperature_received.data[1], 42);
  rclcpp::shutdown();
}

TEST(TelemetryBackends, SnapshotRecoversFreshDataAndExpiresStoppedSources)
{
  int argc = 0;
  rclcpp::init(argc, nullptr);
  auto node = std::make_shared<rclcpp::Node>("recovery_snapshot_test");
  rover::telemetry::RecoverySnapshot snapshot(*node);
  auto input = node->create_publisher<sensor_msgs::msg::JointState>("/telemetry/drive/joint_states", 10);
  auto arm_input = node->create_publisher<sensor_msgs::msg::JointState>("/telemetry/arm/joint_states", 10);
  auto trajectory_input = node->create_publisher<sensor_msgs::msg::JointState>("/telemetry/arm/trajectory_commands", 10);
  auto motor_input = node->create_publisher<arm_interfaces::msg::MotorStat1>("/telemetry/arm/motor_status", 10);
  auto detail_input = node->create_publisher<arm_interfaces::msg::MotorStat2>("/telemetry/arm/motor_detail", 10);
  auto temp_input = node->create_publisher<std_msgs::msg::Int32MultiArray>("/telemetry/drive/temperature_raw", 10);
  auto current_input = node->create_publisher<std_msgs::msg::Int32MultiArray>("/telemetry/drive/current_raw", 10);
  auto odom_input = node->create_publisher<nav_msgs::msg::Odometry>("/telemetry/drive/odometry", 10);
  auto fma_input = node->create_publisher<telemetry_interfaces::msg::FmaState>("/fma/state", rclcpp::QoS(1).reliable().transient_local());
  auto ecam_input = node->create_publisher<telemetry_interfaces::msg::EcamAlerts>("/ecam/alerts", rclcpp::QoS(1).reliable().transient_local());
  std::vector<telemetry_interfaces::msg::RecoverySnapshot> received;
  auto output = node->create_subscription<telemetry_interfaces::msg::RecoverySnapshot>(
    "/telemetry/recovery_snapshot", rclcpp::QoS(1).reliable().transient_local(),
    [&](const telemetry_interfaces::msg::RecoverySnapshot & message) { received.push_back(message); });
  sensor_msgs::msg::JointState sample;
  sample.name = {"front_left_wheel_joint"}; sample.velocity = {1.25};
  sensor_msgs::msg::JointState arm; arm.name = {"base_joint"}; arm.position = {0.4};
  arm_interfaces::msg::MotorStat1 motor; motor.id = 1; motor.temp = 45; motor.current = 1.2; motor.speed = 3.5; motor.angle = 42;
  arm_interfaces::msg::MotorStat2 detail; detail.id = 1; detail.busv = 24; detail.busc = 2; detail.mode = "Speed Control";
  std_msgs::msg::Int32MultiArray temp; temp.data = {0, 42};
  std_msgs::msg::Int32MultiArray current; current.data = {0, 12};
  nav_msgs::msg::Odometry odom; odom.pose.pose.position.x = 2.5;
  telemetry_interfaces::msg::FmaState fma; fma.drive.confirmed = "MANUAL";
  telemetry_interfaces::msg::EcamAlerts ecam; ecam.authority = "rover";
  const auto until = std::chrono::steady_clock::now() + 3s;
  while (received.empty() && std::chrono::steady_clock::now() < until) {
    input->publish(sample); arm_input->publish(arm); trajectory_input->publish(arm);
    motor_input->publish(motor); detail_input->publish(detail); temp_input->publish(temp); current_input->publish(current); odom_input->publish(odom); fma_input->publish(fma); ecam_input->publish(ecam);
    rclcpp::spin_some(node); std::this_thread::sleep_for(20ms);
  }
  ASSERT_FALSE(received.empty());
  EXPECT_TRUE(received.back().drive_joint_valid);
  EXPECT_DOUBLE_EQ(received.back().drive_joints.velocity[0], 1.25);
  EXPECT_TRUE(received.back().arm_joint_valid);
  EXPECT_TRUE(received.back().arm_trajectory_valid);
  EXPECT_TRUE(received.back().fma_valid);
  EXPECT_EQ(received.back().fma.drive.confirmed, "MANUAL");
  EXPECT_TRUE(received.back().ecam_valid);
  ASSERT_EQ(received.back().arm_motors.size(), 1u);
  EXPECT_EQ(received.back().arm_motors[0].temperature, 45);
  EXPECT_DOUBLE_EQ(received.back().arm_motors[0].speed, 3.5);
  ASSERT_EQ(received.back().arm_motor_details.size(), 1u);
  EXPECT_DOUBLE_EQ(received.back().arm_motor_details[0].bus_voltage, 24);
  EXPECT_TRUE(received.back().drive_temperature_valid[0]);
  EXPECT_EQ(received.back().drive_temperature_raw[0], 42);
  EXPECT_TRUE(received.back().drive_current_valid[0]);
  EXPECT_EQ(received.back().drive_current_raw[0], 12);
  EXPECT_TRUE(received.back().drive_odometry_valid);
  EXPECT_DOUBLE_EQ(received.back().drive_odometry.pose.pose.position.x, 2.5);
  EXPECT_FALSE(received.back().unavailable_fields.empty());
  const auto previous = received.size();
  const auto stale_until = std::chrono::steady_clock::now() + 4s;
  while ((received.size() == previous || received.back().drive_joint_valid) && std::chrono::steady_clock::now() < stale_until) {
    rclcpp::spin_some(node); std::this_thread::sleep_for(20ms);
  }
  EXPECT_FALSE(received.back().drive_joint_valid);
  rclcpp::shutdown();
}

TEST(TelemetryBackends, ArmTrajectoryFeedbackProducesDesiredJointCommands)
{
  int argc = 0;
  rclcpp::init(argc, nullptr);
  auto node = std::make_shared<rclcpp::Node>("arm_trajectory_telemetry_test");
  rover::telemetry::arm::JointStateBackend backend(*node);
  using Feedback = control_msgs::action::FollowJointTrajectory::Impl::FeedbackMessage;
  auto input = node->create_publisher<Feedback>("/arm_controller/follow_joint_trajectory/_action/feedback", 10);
  auto status_input = node->create_publisher<action_msgs::msg::GoalStatusArray>(
    "/arm_controller/follow_joint_trajectory/_action/status", rclcpp::QoS(10).reliable().transient_local());
  sensor_msgs::msg::JointState received;
  bool cleared = false;
  auto output = node->create_subscription<sensor_msgs::msg::JointState>("/telemetry/arm/trajectory_commands", 10,
    [&](const sensor_msgs::msg::JointState & message) { received = message; if (message.name.empty()) cleared = true; });
  Feedback sample;
  sample.feedback.joint_names = {"base_joint"}; sample.feedback.desired.positions = {0.75};
  const auto until = std::chrono::steady_clock::now() + 3s;
  while (received.position.empty() && std::chrono::steady_clock::now() < until) {
    input->publish(sample); rclcpp::spin_some(node); std::this_thread::sleep_for(20ms);
  }
  ASSERT_EQ(received.position.size(), 1u);
  EXPECT_DOUBLE_EQ(received.position[0], 0.75);
  action_msgs::msg::GoalStatusArray finished;
  finished.status_list.emplace_back();
  finished.status_list.back().status = action_msgs::msg::GoalStatus::STATUS_CANCELED;
  const auto clear_until = std::chrono::steady_clock::now() + 3s;
  while (!cleared && std::chrono::steady_clock::now() < clear_until) {
    status_input->publish(finished); rclcpp::spin_some(node); std::this_thread::sleep_for(20ms);
  }
  EXPECT_TRUE(cleared);
  rclcpp::shutdown();
}
