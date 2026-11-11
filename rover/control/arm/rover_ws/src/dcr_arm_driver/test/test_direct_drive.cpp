#include "dcr_arm_driver/arm_hardware_interface.hpp"
#include <chrono>
#include <cmath>
#include <gtest/gtest.h>
#include <limits>
#include <thread>
using namespace std::chrono_literals;
using DirectDrive = dcr_arm_driver::msg::DirectDrive;
class TestHardware : public dcr_arm_driver::ArmHardwareInterface {
public:
  rclcpp::Node::SharedPtr node;
  rclcpp::Node::SharedPtr get_node() const override { return node; }
};
class DirectDriveTest : public ::testing::Test {
protected:
  TestHardware hardware;
  rclcpp::executors::SingleThreadedExecutor executor;
  rclcpp::Publisher<can_msgs::msg::Frame>::SharedPtr feedback;
  rclcpp::Publisher<DirectDrive>::SharedPtr commands;
  rclcpp::Publisher<std_msgs::msg::Bool>::SharedPtr estop;
  rclcpp::Publisher<action_msgs::msg::GoalStatusArray>::SharedPtr goals;
  rclcpp::Subscription<can_msgs::msg::Frame>::SharedPtr tx;
  rclcpp::Subscription<telemetry_interfaces::msg::ArmControlStatus>::SharedPtr
      status_sub;
  rclcpp::Client<std_srvs::srv::Trigger>::SharedPtr rearm, folded;
  rclcpp::TimerBase::SharedPtr timer;
  telemetry_interfaces::msg::ArmControlStatus status;
  std::vector<can_msgs::msg::Frame> frames;
  hardware_interface::HardwareComponentInterfaceParams params;
  bool send_feedback = true, send_heartbeat = true, stop = false,
       old_stamp = false;
  uint16_t angle =
      1304; // Nonzero folded startup pose (~0.5 rad), never assumed zero.
  int16_t rpm100 = 0;
  uint8_t fault = 0;
  void SetUp() override {
    hardware.node = std::make_shared<rclcpp::Node>("arm_fault_test");
    executor.add_node(hardware.node);
    params.hardware_info.name = "test_arm";
    params.hardware_info.type = "system";
    params.hardware_info.hardware_parameters = {{"can_interface", "can0"},
                                                {"motion_enabled", "true"}};
    params.hardware_info.original_xml =
        R"(<robot name="arm"><link name="a"/><link name="b"/><link name="c"/>
      <joint name="joint_1" type="revolute"><parent link="a"/><child link="b"/><limit lower="-3.23" upper="3.23" effort="1" velocity="1"/></joint>
      <joint name="joint_2" type="revolute"><parent link="b"/><child link="c"/><limit lower="-3.23" upper="3.23" effort="1" velocity="1"/></joint></robot>)";
    for (unsigned id = 1; id <= 2; ++id) {
      hardware_interface::ComponentInfo j;
      j.name = "joint_" + std::to_string(id);
      params.hardware_info.joints.push_back(j);
      params.hardware_info.hardware_parameters[j.name + "_can_id"] =
          std::to_string(id);
      params.hardware_info
          .hardware_parameters[j.name + "_folded_reference_rad"] =
          "3.141592653589793";
    }
    ASSERT_EQ(hardware.on_init(params),
              hardware_interface::CallbackReturn::SUCCESS);
    feedback = hardware.node->create_publisher<can_msgs::msg::Frame>(
        "/socketcan_bridge/rx", 100);
    commands =
        hardware.node->create_publisher<DirectDrive>("/arm/direct_drive", 10);
    estop = hardware.node->create_publisher<std_msgs::msg::Bool>("/estop", 10);
    goals = hardware.node->create_publisher<action_msgs::msg::GoalStatusArray>(
        "/arm_controller/follow_joint_trajectory/_action/status",
        rclcpp::QoS(1).transient_local());
    tx = hardware.node->create_subscription<can_msgs::msg::Frame>(
        "/socketcan_bridge/tx", 100, [this](const can_msgs::msg::Frame &f) {
          if (f.dlc == 5 && (f.data[0] == 0xC1 || f.data[0] == 0xC2))
            frames.push_back(f);
        });
    status_sub =
        hardware.node
            ->create_subscription<telemetry_interfaces::msg::ArmControlStatus>(
                "/arm/control/status", 10,
                [this](const telemetry_interfaces::msg::ArmControlStatus &s) {
                  status = s;
                });
    rearm = hardware.node->create_client<std_srvs::srv::Trigger>("/arm/rearm");
    folded = hardware.node->create_client<std_srvs::srv::Trigger>(
        "/arm/confirm_folded_pose");
    ASSERT_EQ(hardware.on_activate(rclcpp_lifecycle::State()),
              hardware_interface::CallbackReturn::SUCCESS);
    timer = hardware.node->create_wall_timer(20ms, [this] {
      if (send_heartbeat) {
        std_msgs::msg::Bool s;
        s.data = stop;
        estop->publish(s);
      }
      if (!send_feedback)
        return;
      for (unsigned id = 1; id <= 2; ++id) {
        can_msgs::msg::Frame f;
        f.id = id;
        f.dlc = 8;
        f.header.stamp = hardware.node->now() -
                         rclcpp::Duration::from_seconds(old_stamp ? 1 : 0);
        f.data[0] = 0xA4;
        f.data[4] = rpm100 & 255;
        f.data[5] = (uint16_t(rpm100) >> 8);
        f.data[6] = angle & 255;
        f.data[7] = angle >> 8;
        feedback->publish(f);
        f.data = {0xAE, 0x60, 0x09, 0, 0, 0, 0, fault};
        feedback->publish(f);
      }
    });
    run(650ms);
  }
  void TearDown() override {
    timer.reset();
    hardware.on_deactivate(rclcpp_lifecycle::State());
    executor.spin_some();
    executor.remove_node(hardware.node);
  }
  void cycle() {
    executor.spin_all(5ms);
    hardware.read(rclcpp::Time(0), rclcpp::Duration::from_seconds(.02));
    hardware.write(rclcpp::Time(0), rclcpp::Duration::from_seconds(.02));
    executor.spin_all(5ms);
  }
  void run(std::chrono::milliseconds duration) {
    auto end = std::chrono::steady_clock::now() + duration;
    do {
      cycle();
      std::this_thread::sleep_for(5ms);
    } while (std::chrono::steady_clock::now() < end);
  }
  bool call(rclcpp::Client<std_srvs::srv::Trigger>::SharedPtr client) {
    if (!client->wait_for_service(1s))
      return false;
    auto f = client->async_send_request(
        std::make_shared<std_srvs::srv::Trigger::Request>());
    auto end = std::chrono::steady_clock::now() + 1s;
    while (f.wait_for(0s) != std::future_status::ready &&
           std::chrono::steady_clock::now() < end)
      run(5ms);
    return f.wait_for(0s) == std::future_status::ready && f.get()->success;
  }
  void command(uint8_t mode, double value = 0) {
    DirectDrive m;
    m.id = 1;
    m.mode = mode;
    m.value = value;
    commands->publish(m);
    run(120ms);
  }
  can_msgs::msg::Frame latest(unsigned id = 1) {
    for (auto it = frames.rbegin(); it != frames.rend(); ++it)
      if (it->id == id)
        return *it;
    return {};
  }
  void stopped() {
    run(120ms);
    for (unsigned id = 1; id <= 2; ++id) {
      auto f = latest(id);
      EXPECT_EQ(f.data[0], 0xC1);
      for (int b = 1; b < 5; ++b)
        EXPECT_EQ(f.data[b], 0);
    }
  }
  void speed() {
    auto f = latest();
    EXPECT_EQ(f.data[0], 0xC1);
    EXPECT_EQ(f.data[1], 0xF4) << status.reason;
    EXPECT_EQ(f.data[2], 1);
  }
};
TEST_F(DirectDriveTest, ReportsAcceptedDirectControlForEachConfiguredJoint) {
  EXPECT_FALSE(status.direct_ready);
  ASSERT_TRUE(call(rearm));
  run(40ms);
  ASSERT_TRUE(status.direct_ready);
  ASSERT_EQ(status.joint_names.size(), 2u);
  EXPECT_EQ(status.joint_can_ids, (std::vector<uint32_t>{1, 2}));
  DirectDrive cmd;
  cmd.mode = DirectDrive::SPEED;
  cmd.request_id = 123;
  cmd.id = 1; commands->publish(cmd);
  cmd.id = 2; commands->publish(cmd);
  run(80ms);
  ASSERT_EQ(status.direct_request_ids.size(), 2u);
  EXPECT_EQ(status.direct_request_ids[0], 123u);
  EXPECT_EQ(status.direct_request_ids[1], 123u);
  run(300ms);
  EXPECT_FALSE(status.direct_ready);
  EXPECT_EQ(status.direct_request_ids[0], 0u);
  EXPECT_EQ(status.direct_request_ids[1], 0u);
}
TEST_F(DirectDriveTest, StartupIsLatchedAtMeasuredFoldedPose) {
  stopped();
  EXPECT_TRUE(status.motion_inhibited);
  auto states = hardware.export_state_interfaces();
  EXPECT_NEAR(states[0].get_value(), .5, .001);
  ASSERT_TRUE(call(rearm));
  command(DirectDrive::SPEED, 5);
  speed();
}
TEST_F(DirectDriveTest, DirectCommandLeaseExpiresWithHealthyFeedback) {
  ASSERT_TRUE(call(rearm));
  command(DirectDrive::SPEED, 5);
  speed();
  run(300ms);
  stopped();
  EXPECT_TRUE(status.feedback_fresh);
  command(DirectDrive::SPEED, 5);
  stopped();
  run(600ms);
  ASSERT_TRUE(call(rearm));
  command(DirectDrive::SPEED, 5);
  speed();
}
TEST_F(DirectDriveTest, HeartbeatExpiryStopsAllJoints) {
  ASSERT_TRUE(call(rearm));
  send_heartbeat = false;
  run(550ms);
  stopped();
  EXPECT_FALSE(status.estop_clear);
  EXPECT_FALSE(call(rearm));
}
TEST_F(DirectDriveTest, FaultClearCannotResumeOldCommand) {
  ASSERT_TRUE(call(rearm));
  command(DirectDrive::SPEED, 5);
  fault = 1;
  run(30ms);
  stopped();
  EXPECT_FALSE(call(rearm));
  fault = 0;
  run(600ms);
  command(DirectDrive::SPEED, 5);
  stopped();
  ASSERT_TRUE(call(rearm));
}
TEST_F(DirectDriveTest, EveryReportedFaultBitLatches) {
  for (unsigned bit = 0; bit < 8; ++bit) {
    ASSERT_TRUE(call(rearm));
    fault = 1u << bit;
    run(30ms);
    stopped();
    fault = 0;
    run(600ms);
    EXPECT_TRUE(status.motion_inhibited);
  }
}
TEST_F(DirectDriveTest, EstopClearNeedsExplicitRearm) {
  ASSERT_TRUE(call(rearm));
  command(DirectDrive::SPEED, 5);
  stop = true;
  run(30ms);
  stopped();
  stop = false;
  run(600ms);
  command(DirectDrive::SPEED, 5);
  stopped();
  run(600ms);
  ASSERT_TRUE(call(rearm));
  command(DirectDrive::SPEED, 5);
  speed();
}
TEST_F(DirectDriveTest, LostCanAndCollapseRequireFreshReference) {
  ASSERT_TRUE(call(rearm));
  send_feedback = false;
  run(300ms);
  stopped();
  send_feedback = true;
  angle = 8192;
  run(600ms);
  EXPECT_FALSE(status.feedback_fresh);
  EXPECT_FALSE(call(rearm));
  stop = true;
  run(120ms);
  ASSERT_TRUE(call(folded));
  run(150ms);
  EXPECT_TRUE(status.feedback_fresh);
  stop = false;
  run(600ms);
  ASSERT_TRUE(call(rearm));
}
TEST_F(DirectDriveTest, FoldedConfirmationRequiresActualMatchingPose) {
  stop = true;
  run(120ms);
  EXPECT_FALSE(call(folded));
}
TEST_F(DirectDriveTest, OldStampedFeedbackDoesNotRenewFreshness) {
  ASSERT_TRUE(call(rearm));
  old_stamp = true;
  run(300ms);
  stopped();
  EXPECT_FALSE(status.feedback_fresh);
}
TEST_F(DirectDriveTest, EncoderOutsideProtocolRangeLatches) {
  ASSERT_TRUE(call(rearm));
  angle = 20000;
  run(40ms);
  stopped();
  EXPECT_FALSE(call(rearm));
}
TEST_F(DirectDriveTest, OverspeedLatches) {
  ASSERT_TRUE(call(rearm));
  rpm100 = 2000;
  run(40ms);
  stopped();
  EXPECT_FALSE(call(rearm));
}
TEST_F(DirectDriveTest, CanErrorLatches) {
  ASSERT_TRUE(call(rearm));
  can_msgs::msg::Frame f;
  f.is_error = true;
  feedback->publish(f);
  run(40ms);
  stopped();
}
TEST_F(DirectDriveTest, InvalidCommandsDoNotReplaceValidCommand) {
  ASSERT_TRUE(call(rearm));
  command(DirectDrive::SPEED, 5);
  command(255, 1);
  speed();
  command(DirectDrive::SPEED, 5);
  command(DirectDrive::POSITION, std::numeric_limits<double>::quiet_NaN());
  speed();
  command(DirectDrive::SPEED, 5);
  command(DirectDrive::POSITION, 500);
  speed();
}
TEST_F(DirectDriveTest, PositionCommandIsRateLimited) {
  ASSERT_TRUE(call(rearm));
  frames.clear();
  command(DirectDrive::POSITION, 90);
  double previous = .5;
  unsigned samples = 0;
  for (const auto &f : frames) {
    if (f.id != 1 || f.data[0] != 0xC2)
      continue;
    const uint32_t raw = f.data[1] | (f.data[2] << 8);
    const double position = raw * 6.283185307 / 16384.0;
    EXPECT_LE(std::abs(position - previous), .0205);
    previous = position;
    ++samples;
  }
  EXPECT_GT(samples, 1u);
  EXPECT_LT(previous, 1.57);
}
TEST_F(DirectDriveTest, SpeedToPositionHoldStartsAtMeasuredPose) {
  ASSERT_TRUE(call(rearm));
  command(DirectDrive::SPEED, 5);
  speed();
  angle = 1540; // Jog from ~0.50 to ~0.59 rad under speed control.
  run(40ms);
  const double measured = angle * 6.283185307 / 16384.0;
  frames.clear();
  command(DirectDrive::POSITION, measured * 180.0 / 3.141592653589793);

  unsigned samples = 0;
  for (const auto &f : frames) {
    if (f.id != 1 || f.data[0] != 0xC2)
      continue;
    const uint32_t raw = uint32_t(f.data[1]) | (uint32_t(f.data[2]) << 8) |
                         (uint32_t(f.data[3]) << 16) |
                         (uint32_t(f.data[4]) << 24);
    const double position = raw * 6.283185307 / 16384.0;
    // Allow two encoder counts for the two position-frame conversions.
    EXPECT_NEAR(position, measured, 2 * 6.283185307 / 16384.0);
    ++samples;
  }
  EXPECT_GT(samples, 1u);
}
TEST_F(DirectDriveTest, SpeedToPositionReseedsOnceAndKeepsRateLimit) {
  ASSERT_TRUE(call(rearm));
  command(DirectDrive::SPEED, -5);
  ASSERT_EQ(latest().data[0], 0xC1);
  angle = 1069; // Jog from ~0.50 to ~0.41 rad under speed control.
  run(40ms);
  double previous = angle * 6.283185307 / 16384.0;
  frames.clear();
  command(DirectDrive::POSITION, -90);
  // Refresh the position command while feedback remains at the jogged pose.
  // This must continue the ramp, not reseed it on every position message.
  command(DirectDrive::POSITION, -90);

  unsigned samples = 0;
  for (const auto &f : frames) {
    if (f.id != 1 || f.data[0] != 0xC2)
      continue;
    const uint32_t bits = uint32_t(f.data[1]) | (uint32_t(f.data[2]) << 8) |
                          (uint32_t(f.data[3]) << 16) |
                          (uint32_t(f.data[4]) << 24);
    const int32_t raw = bits & 0x80000000U ? -1 - int32_t(~bits) : int32_t(bits);
    const double position = raw * 6.283185307 / 16384.0;
    EXPECT_LE(std::abs(position - previous), .0208);
    EXPECT_LE(position, previous);
    previous = position;
    ++samples;
  }
  EXPECT_GT(samples, 1u);
}
TEST_F(DirectDriveTest, ReleaseDoesNotResumeControllerTarget) {
  ASSERT_TRUE(call(rearm));
  command(DirectDrive::SPEED, 5);
  command(DirectDrive::CONTROLLER);
  stopped();
}
TEST_F(DirectDriveTest, ActiveTrajectoryRejectsDirectAndRearm) {
  ASSERT_TRUE(call(rearm));
  action_msgs::msg::GoalStatusArray a;
  action_msgs::msg::GoalStatus g;
  g.status = 2;
  a.status_list.push_back(g);
  goals->publish(a);
  run(30ms);
  command(DirectDrive::SPEED, 5);
  EXPECT_EQ(latest().data[0], 0xC2);
  EXPECT_FALSE(call(rearm));
}
TEST_F(DirectDriveTest, NonfiniteControllerTargetLatches) {
  ASSERT_TRUE(call(rearm));
  action_msgs::msg::GoalStatusArray a;
  action_msgs::msg::GoalStatus g;
  g.status = 2;
  a.status_list.push_back(g);
  goals->publish(a);
  run(20ms);
  auto interfaces = hardware.export_command_interfaces();
  ASSERT_TRUE(
      interfaces[0].set_value(std::numeric_limits<double>::quiet_NaN()));
  run(20ms);
  stopped();
}
TEST_F(DirectDriveTest, InvalidConfigurationRejected) {
  TestHardware h;
  auto invalid = params;
  invalid.hardware_info.hardware_parameters["joint_2_can_id"] = "1";
  EXPECT_EQ(h.on_init(invalid), hardware_interface::CallbackReturn::ERROR);
}
TEST_F(DirectDriveTest, DefaultConfigurationDisablesMotion) {
  hardware.on_deactivate(rclcpp_lifecycle::State());
  params.hardware_info.hardware_parameters.erase("motion_enabled");
  ASSERT_EQ(hardware.on_init(params),
            hardware_interface::CallbackReturn::SUCCESS);
  ASSERT_EQ(hardware.on_activate(rclcpp_lifecycle::State()),
            hardware_interface::CallbackReturn::SUCCESS);
  run(650ms);
  EXPECT_FALSE(call(rearm));
  command(DirectDrive::SPEED, 5);
  stopped();
}
TEST_F(DirectDriveTest, TeardownPublishesInactiveState) {
  hardware.on_deactivate(rclcpp_lifecycle::State());
  executor.spin_some();
  EXPECT_FALSE(status.hardware_active);
}
// Initialize ROS before the fixture's executor is constructed.
class RosEnvironment : public ::testing::Environment {
  void SetUp() override {
    if (!rclcpp::ok())
      rclcpp::init(0, nullptr);
  }
  void TearDown() override { rclcpp::shutdown(); }
};
static auto *const ros_environment =
    ::testing::AddGlobalTestEnvironment(new RosEnvironment);

TEST_F(DirectDriveTest, DirectSpeedStopsOutwardAtLimitButAllowsRetreat) {
  ASSERT_TRUE(call(rearm));
  angle = 8400; // ~3.22 rad, within 0.02 rad of the upper limit.
  run(60ms);
  command(DirectDrive::SPEED, 5);
  auto output = latest();
  EXPECT_EQ(output.data[0], 0xC1);
  EXPECT_EQ(output.data[1], 0);
  command(DirectDrive::SPEED, -5);
  output = latest();
  EXPECT_EQ(output.data[1], 0x0c);
  EXPECT_EQ(output.data[2], 0xfe);
}

TEST(MotorProtocol, GdzV307CommandVectors) {
  dcr_arm_driver::Motor motor;
  const auto speed = motor.speed_control(1, 100);
  EXPECT_EQ(speed.dlc, 5);
  EXPECT_EQ(speed.data, (std::array<uint8_t, 8>{0xc1,0x10,0x27,0,0,0,0,0}));
  const auto position = motor.position_control(1, 360);
  EXPECT_EQ(position.data, (std::array<uint8_t, 8>{0xc2,0,0x40,0,0,0,0,0}));
}
