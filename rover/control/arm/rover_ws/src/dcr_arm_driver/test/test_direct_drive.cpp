#include <chrono>
#include <limits>
#include <thread>
#include <vector>

#include <gtest/gtest.h>
#include "dcr_arm_driver/arm_hardware_interface.hpp"

using namespace std::chrono_literals;
using DirectDrive = dcr_arm_driver::msg::DirectDrive;

// Use a spun test node in place of controller_manager's hardware node.
class TestHardware : public dcr_arm_driver::ArmHardwareInterface {
 public:
  rclcpp::Node::SharedPtr node;
  rclcpp::Node::SharedPtr get_node() const override { return node; }
};

class DirectDriveTest : public ::testing::Test {
 protected:
  void SetUp() override {
    if (!rclcpp::ok()) {
      rclcpp::init(0, nullptr);
    }
    executor = std::make_unique<rclcpp::executors::SingleThreadedExecutor>();
    hardware.node = std::make_shared<rclcpp::Node>("direct_drive_test");
    executor->add_node(hardware.node);
    hardware_interface::HardwareComponentInterfaceParams params;
    params.hardware_info.name = "test_arm";
    params.hardware_info.type = "system";
    params.hardware_info.hardware_parameters["can_interface"] = "can0";
    for (unsigned id = 1; id <= 2; ++id) {
      hardware_interface::ComponentInfo joint;
      joint.name = "joint_" + std::to_string(id);
      params.hardware_info.joints.push_back(joint);
      params.hardware_info.hardware_parameters[joint.name + "_can_id"] =
          std::to_string(id);
    }
    ASSERT_EQ(hardware.on_init(params), hardware_interface::CallbackReturn::SUCCESS);
    frames_sub = hardware.node->create_subscription<can_msgs::msg::Frame>(
        "/socketcan_bridge/tx", 100,
        [this](const can_msgs::msg::Frame& frame) { frames.push_back(frame); });
    feedback = hardware.node->create_publisher<can_msgs::msg::Frame>(
        "/socketcan_bridge/rx", 10);
    commands = hardware.node->create_publisher<DirectDrive>("/arm/direct_drive", 1);
    estop = hardware.node->create_publisher<std_msgs::msg::Bool>("/estop", 1);
    ASSERT_EQ(hardware.on_activate(rclcpp_lifecycle::State()),
              hardware_interface::CallbackReturn::SUCCESS);
    publish_feedback();
    ASSERT_EQ(hardware.read(rclcpp::Time(0), rclcpp::Duration::from_seconds(0.02)),
              hardware_interface::return_type::OK);
    auto interfaces = hardware.export_command_interfaces();
    ASSERT_TRUE(interfaces[0].set_value(0.5));
    ASSERT_TRUE(interfaces[1].set_value(1.0));
  }

  void TearDown() override {
    if (executor && hardware.node) {
      hardware.on_deactivate(rclcpp_lifecycle::State());
      executor->remove_node(hardware.node);
    }
  }

  void spin() {
    const auto deadline = std::chrono::steady_clock::now() + 100ms;
    do {
      executor->spin_some();
      std::this_thread::sleep_for(1ms);
    } while (std::chrono::steady_clock::now() < deadline);
  }

  void command(uint8_t mode, double value = 0.0, uint32_t id = 1) {
    DirectDrive msg;
    msg.id = id;
    msg.mode = mode;
    msg.value = value;
    commands->publish(msg);
    spin();
  }

  void publish_feedback() {
    for (uint32_t id = 1; id <= 2; ++id) {
      can_msgs::msg::Frame frame;
      frame.id = id;
      frame.dlc = 8;
      frame.data[0] = 0xA4;
      feedback->publish(frame);
    }
    spin();
  }

  void check_write(const can_msgs::msg::Frame& expected) {
    frames.clear();
    ASSERT_EQ(hardware.write(rclcpp::Time(0), rclcpp::Duration::from_seconds(0.02)),
              hardware_interface::return_type::OK);
    spin();
    ASSERT_EQ(frames.size(), 2u);
    EXPECT_EQ(frames[0].id, expected.id);
    EXPECT_EQ(frames[0].data, expected.data);
    // Direct drive must not change the other joint's controller output.
    EXPECT_EQ(frames[1].data, motor.position_control(2, 180 / 3.14159265).data);
  }

  TestHardware hardware;
  dcr_arm_driver::Motor motor;
  std::unique_ptr<rclcpp::executors::SingleThreadedExecutor> executor;
  rclcpp::Subscription<can_msgs::msg::Frame>::SharedPtr frames_sub;
  rclcpp::Publisher<can_msgs::msg::Frame>::SharedPtr feedback;
  rclcpp::Publisher<DirectDrive>::SharedPtr commands;
  rclcpp::Publisher<std_msgs::msg::Bool>::SharedPtr estop;
  std::vector<can_msgs::msg::Frame> frames;
};

TEST_F(DirectDriveTest, DirectCommandsPersistAndCanReturnToController) {
  command(DirectDrive::SPEED, 20.0);
  for (int i = 0; i < 3; ++i) {
    check_write(motor.speed_control(1, 20.0));
  }
  command(DirectDrive::POSITION, 10.0);
  for (int i = 0; i < 3; ++i) {
    check_write(motor.position_control(1, 10.0));
  }
  command(DirectDrive::CONTROLLER);
  check_write(motor.position_control(1, 0.5 * 180 / 3.14159265));
}

TEST_F(DirectDriveTest, InvalidCommandsDoNotReplaceLatchedCommand) {
  command(DirectDrive::SPEED, 20.0);
  command(255, 10.0);
  command(DirectDrive::POSITION, std::numeric_limits<double>::quiet_NaN());
  command(DirectDrive::SPEED, std::numeric_limits<double>::infinity());
  command(DirectDrive::SPEED, std::numeric_limits<double>::max());
  command(DirectDrive::POSITION, 10.0, 99);
  check_write(motor.speed_control(1, 20.0));
}

TEST_F(DirectDriveTest, PositionOutsideJointLimitsIsRejected) {
  command(DirectDrive::POSITION, 10.0);
  command(DirectDrive::POSITION, 181.0);
  check_write(motor.position_control(1, 10.0));
}

TEST_F(DirectDriveTest, EstopOverridesDirectDriveAndActivationResetsIt) {
  command(DirectDrive::SPEED, 20.0);
  std_msgs::msg::Bool stop;
  stop.data = true;
  estop->publish(stop);
  spin();
  command(DirectDrive::POSITION, 10.0);
  frames.clear();
  hardware.write(rclcpp::Time(0), rclcpp::Duration::from_seconds(0.02));
  spin();
  ASSERT_EQ(frames.size(), 2u);
  for (const auto& frame : frames) {
    EXPECT_EQ(frame.data, motor.speed_control(frame.id, 0.0).data);
  }
  stop.data = false;
  estop->publish(stop);
  spin();
  check_write(motor.speed_control(1, 20.0));
  hardware.on_deactivate(rclcpp_lifecycle::State());
  hardware.on_activate(rclcpp_lifecycle::State());
  publish_feedback();
  hardware.read(rclcpp::Time(0), rclcpp::Duration::from_seconds(0.02));
  auto interfaces = hardware.export_command_interfaces();
  ASSERT_TRUE(interfaces[0].set_value(0.5));
  ASSERT_TRUE(interfaces[1].set_value(1.0));
  check_write(motor.position_control(1, 0.5 * 180 / 3.14159265));
}
