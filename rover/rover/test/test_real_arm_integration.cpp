#include <chrono>
#include <thread>
#include <gtest/gtest.h>
#include <dcr_arm_driver/arm_hardware_interface.hpp>
#include <sensor_msgs/msg/joy.hpp>
#include <std_msgs/msg/string.hpp>
#include <telemetry_interfaces/msg/fma_state.hpp>
#include "rover/rover_node.hpp"

using namespace std::chrono_literals;
class IntegrationHardware : public dcr_arm_driver::ArmHardwareInterface {
public:
  rclcpp::Node::SharedPtr node;
  rclcpp::Node::SharedPtr get_node() const override { return node; }
};
TEST(RealArmIntegration, ManualUsesDriverFeedbackAndStopsWhenInputExpires)
{
  int argc = 0; rclcpp::init(argc, nullptr);
  IntegrationHardware hw;
  hw.node = std::make_shared<rclcpp::Node>("arm_integration_driver");
  hardware_interface::HardwareComponentInterfaceParams params;
  params.hardware_info.name = "test_arm"; params.hardware_info.type = "system";
  params.hardware_info.hardware_parameters = {{"can_interface", "can0"}, {"motion_enabled", "true"},
    {"base_joint_can_id", "7"}, {"base_joint_folded_reference_rad", "3.141592653589793"}};
  params.hardware_info.original_xml = R"(<robot name="arm"><link name="a"/><link name="b"/>
    <joint name="base_joint" type="revolute"><parent link="a"/><child link="b"/>
    <limit lower="-3.23" upper="3.23" effort="1" velocity="1"/></joint></robot>)";
  hardware_interface::ComponentInfo joint; joint.name = "base_joint"; params.hardware_info.joints.push_back(joint);
  ASSERT_EQ(hw.on_init(params), hardware_interface::CallbackReturn::SUCCESS);
  auto feedback = hw.node->create_publisher<can_msgs::msg::Frame>("/socketcan_bridge/rx", 100);
  auto estop = hw.node->create_publisher<std_msgs::msg::Bool>("/estop", 10);
  auto rearm = hw.node->create_client<std_srvs::srv::Trigger>("/arm/rearm");
  auto mode = hw.node->create_publisher<std_msgs::msg::String>("/fma/arm/request", 10);
  auto joy = hw.node->create_publisher<sensor_msgs::msg::Joy>("/arm/joy", 10);
  telemetry_interfaces::msg::FmaState fma;
  auto fma_sub = hw.node->create_subscription<telemetry_interfaces::msg::FmaState>("/fma/state",
    rclcpp::QoS(1).reliable().transient_local(), [&](const telemetry_interfaces::msg::FmaState & msg) { fma = msg; });
  telemetry_interfaces::msg::ArmControlStatus arm_status;
  auto status_sub = hw.node->create_subscription<telemetry_interfaces::msg::ArmControlStatus>("/arm/control/status", 10,
    [&](const telemetry_interfaces::msg::ArmControlStatus & status) { arm_status = status; });
  int32_t last_speed = 0;
  bool saw_speed = false;
  unsigned tx_count = 0, matching_frames = 0;
  int max_raw = 0;
  double last_direct = 0;
  uint32_t direct_id = 0;
  uint8_t direct_mode = 0;
  auto command_sub = hw.node->create_subscription<dcr_arm_driver::msg::DirectDrive>("/arm/direct_drive", 32,
    [&](const dcr_arm_driver::msg::DirectDrive & cmd) { last_direct = cmd.value; direct_id = cmd.id; direct_mode = cmd.mode; });
  auto tx = hw.node->create_subscription<can_msgs::msg::Frame>("/socketcan_bridge/tx", 100,
    [&](const can_msgs::msg::Frame & msg) {
      ++tx_count;
      if (msg.id == 7 && msg.data[0] == 0xC1) {
        ++matching_frames;
        uint32_t bits = uint32_t(msg.data[1]) | (uint32_t(msg.data[2]) << 8) |
          (uint32_t(msg.data[3]) << 16) | (uint32_t(msg.data[4]) << 24);
        last_speed = static_cast<int32_t>(bits);
        max_raw = std::max(max_raw, last_speed);
        if (last_speed == 100) saw_speed = true;
      }
    });
  ASSERT_EQ(hw.on_activate(rclcpp_lifecycle::State()), hardware_interface::CallbackReturn::SUCCESS);
  rclcpp::NodeOptions options;
  options.parameter_overrides({rclcpp::Parameter("arm_backend", "real"),
    rclcpp::Parameter("arm_manual_speed_rpm", std::vector<double>(6, 1.0))});
  auto rover_node = rover::make_rover_node(options);
  rclcpp::executors::SingleThreadedExecutor executor;
  executor.add_node(hw.node); executor.add_node(rover_node);
  auto timer = hw.node->create_wall_timer(20ms, [&] {
    std_msgs::msg::Bool clear; clear.data = false; estop->publish(clear);
    can_msgs::msg::Frame frame; frame.id = 7; frame.dlc = 8; frame.header.stamp = hw.node->now();
    frame.data[0] = 0xA4; frame.data[6] = 1304 & 255; frame.data[7] = 1304 >> 8; feedback->publish(frame);
    frame.data = {0xAE, 0x60, 0x09, 0, 0, 0, 0, 0}; feedback->publish(frame);
  });
  const auto run = [&](std::chrono::milliseconds duration) {
    auto end = std::chrono::steady_clock::now() + duration;
    while (std::chrono::steady_clock::now() < end) {
      executor.spin_all(5ms); hw.read(rclcpp::Time(0), rclcpp::Duration::from_seconds(.02));
      hw.write(rclcpp::Time(0), rclcpp::Duration::from_seconds(.02));
      executor.spin_all(5ms); std::this_thread::sleep_for(5ms);
    }
  };
  run(700ms);
  auto future = rearm->async_send_request(std::make_shared<std_srvs::srv::Trigger::Request>());
  run(100ms);
  ASSERT_EQ(future.wait_for(0s), std::future_status::ready);
  ASSERT_TRUE(future.get()->success);
  std_msgs::msg::String request; request.data = "MANUAL"; mode->publish(request);
  run(600ms); EXPECT_EQ(fma.arm.confirmed, "MANUAL");
  sensor_msgs::msg::Joy input; input.axes = std::vector<float>(10, 0); input.buttons = std::vector<int32_t>(12, 0);
  input.axes[0] = 1.0; joy->publish(input); run(150ms); EXPECT_TRUE(saw_speed) << "tx=" << tx_count << " matched=" << matching_frames << " max=" << max_raw << " id=" << direct_id << " mode=" << int(direct_mode) << " direct=" << last_direct << " FMA=" << fma.arm.confirmed << " reason=" << arm_status.reason;
  run(400ms); EXPECT_EQ(last_speed, 0);
  executor.remove_node(rover_node); rover_node.reset();
  timer.reset(); hw.on_deactivate(rclcpp_lifecycle::State()); executor.remove_node(hw.node);
  rclcpp::shutdown();
}
