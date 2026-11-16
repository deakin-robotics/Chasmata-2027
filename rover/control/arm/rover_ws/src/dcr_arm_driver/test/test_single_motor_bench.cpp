#include "dcr_arm_driver/single_motor_bench.hpp"
#include "std_msgs/msg/bool.hpp"
#include <gtest/gtest.h>
#include <thread>

using namespace std::chrono_literals;

TEST(SingleMotorBench, SendsOnlyRequestedAnglesWithoutArmInterlocks) {
  rclcpp::init(0, nullptr);
  rclcpp::NodeOptions options;
  options.parameter_overrides({rclcpp::Parameter("shortest_path", false)});
  auto bench = std::make_shared<dcr_arm_driver::SingleMotorBench>(options);
  auto peer = std::make_shared<rclcpp::Node>("bench_test_peer");
  rclcpp::executors::SingleThreadedExecutor executor;
  executor.add_node(bench);
  executor.add_node(peer);
  std::vector<can_msgs::msg::Frame> frames;
  auto rx = peer->create_subscription<can_msgs::msg::Frame>(
      "/arm/bench/tx", 10, [&](const can_msgs::msg::Frame &f) {
        if (f.data[0] != 0xA3) frames.push_back(f);
      });
  auto goals = peer->create_publisher<std_msgs::msg::Float64>("/arm/bench/angle_deg", 10);
  auto estop = peer->create_publisher<std_msgs::msg::Bool>("/estop", 10);
  auto spin = [&](std::chrono::milliseconds duration) {
    auto end = std::chrono::steady_clock::now() + duration;
    do { executor.spin_some(); std::this_thread::sleep_for(5ms); }
    while (std::chrono::steady_clock::now() < end);
  };
  spin(500ms);
  EXPECT_TRUE(frames.empty()); // No startup motion.
  ASSERT_EQ(goals->get_subscription_count(), 1u);
  auto command = [&](double degrees) {
    std_msgs::msg::Float64 msg;
    msg.data = degrees;
    goals->publish(msg);
    spin(100ms);
  };
  command(360); // No feedback, heartbeat, controller, or rearm.
  ASSERT_EQ(frames.size(), 1u);
  EXPECT_EQ(frames.back().id, 5u);
  EXPECT_EQ(frames.back().dlc, 5u);
  EXPECT_FALSE(frames.back().is_extended);
  EXPECT_EQ(frames.back().data, (std::array<uint8_t, 8>{0xC2,0,0x40,0,0,0,0,0}));
  std_msgs::msg::Bool stop;
  stop.data = true;
  estop->publish(stop);
  spin(100ms);
  command(-90);
  ASSERT_EQ(frames.size(), 2u);
  EXPECT_EQ(frames.back().data, (std::array<uint8_t, 8>{0xC2,0,0xF0,0xFF,0xFF,0,0,0}));
  command(std::numeric_limits<double>::quiet_NaN());
  command(std::numeric_limits<double>::infinity());
  command(1e20);
  command(47185920); // 2^31 counts: just outside signed protocol range.
  EXPECT_EQ(frames.size(), 2u);
  spin(600ms); // No lease timeout or automatic replacement of the angle.
  EXPECT_EQ(frames.size(), 2u);
  auto client = peer->create_client<std_srvs::srv::Trigger>("/arm/bench/stop");
  ASSERT_TRUE(client->wait_for_service(1s));
  auto reply = client->async_send_request(std::make_shared<std_srvs::srv::Trigger::Request>());
  ASSERT_EQ(executor.spin_until_future_complete(reply, 1s), rclcpp::FutureReturnCode::SUCCESS);
  EXPECT_TRUE(reply.get()->success);
  spin(100ms);
  ASSERT_EQ(frames.size(), 3u);
  EXPECT_EQ(frames.back().id, 5u);
  EXPECT_EQ(frames.back().data, (std::array<uint8_t, 8>{0xC1,0,0,0,0,0,0,0}));
  for (int id : {0, 255, 2047, -1}) {
    rclcpp::NodeOptions options;
    options.parameter_overrides({rclcpp::Parameter("motor_id", id)});
    EXPECT_THROW(std::make_shared<dcr_arm_driver::SingleMotorBench>(options), std::invalid_argument);
  }
  executor.remove_node(bench);
  executor.remove_node(peer);
  rclcpp::shutdown();
}

TEST(SingleMotorBench, NearestAnglePreservesTurnsAndDoesNotReplayGoals) {
  rclcpp::init(0, nullptr);
  auto bench = std::make_shared<dcr_arm_driver::SingleMotorBench>();
  auto peer = std::make_shared<rclcpp::Node>("nearest_angle_test");
  rclcpp::executors::SingleThreadedExecutor executor;
  executor.add_node(bench);
  executor.add_node(peer);
  std::vector<can_msgs::msg::Frame> frames;
  auto rx = peer->create_subscription<can_msgs::msg::Frame>(
      "/arm/bench/tx", 10, [&](const can_msgs::msg::Frame &f) {
        if (f.data[0] == 0xC2) frames.push_back(f);
      });
  auto goals = peer->create_publisher<std_msgs::msg::Float64>("/arm/bench/angle_deg", 10);
  auto feedback = peer->create_publisher<can_msgs::msg::Frame>("/arm/bench/rx", 10);
  auto spin = [&](std::chrono::milliseconds duration) {
    auto end = std::chrono::steady_clock::now() + duration;
    do { executor.spin_some(); std::this_thread::sleep_for(5ms); }
    while (std::chrono::steady_clock::now() < end);
  };
  auto command = [&](double degrees) {
    std_msgs::msg::Float64 msg; msg.data = degrees;
    goals->publish(msg); spin(50ms);
  };
  auto report = [&](int32_t counts, uint32_t id = 5) {
    can_msgs::msg::Frame f;
    f.id = id; f.dlc = 7; f.data[0] = 0xA3;
    for (unsigned b = 0; b < 4; ++b) f.data[b + 3] = uint32_t(counts) >> (8 * b);
    feedback->publish(f); spin(50ms);
  };
  auto target = [&]() -> int64_t {
    const auto &d = frames.back().data;
    uint32_t bits = uint32_t(d[1]) | (uint32_t(d[2]) << 8) |
        (uint32_t(d[3]) << 16) | (uint32_t(d[4]) << 24);
    return bits & 0x80000000U ? int64_t(bits) - 0x100000000LL : bits;
  };
  spin(500ms);
  command(60);
  EXPECT_TRUE(frames.empty());
  report(3 * 16384 + 4096, 4); // Other motors cannot supply our angle.
  EXPECT_TRUE(frames.empty());
  report(3 * 16384 + 4096); // 1170 degrees -> 1140, not back to 60.
  ASSERT_EQ(frames.size(), 1u);
  EXPECT_EQ(target(), 3 * 16384 + 2731);
  report(3 * 16384 + 2731);
  EXPECT_EQ(frames.size(), 1u); // Polls do not reissue movement.
  command(0);
  report(-3 * 16384 - 455); // Negative accumulated turns, about -10 deg.
  ASSERT_EQ(frames.size(), 2u);
  EXPECT_EQ(target(), -3 * 16384);
  command(60);
  spin(1200ms);
  report(0);
  EXPECT_EQ(frames.size(), 2u); // Expired requests cannot move on reconnect.
  command(60);
  auto stop = peer->create_client<std_srvs::srv::Trigger>("/arm/bench/stop");
  ASSERT_TRUE(stop->wait_for_service(1s));
  auto reply = stop->async_send_request(std::make_shared<std_srvs::srv::Trigger::Request>());
  ASSERT_EQ(executor.spin_until_future_complete(reply, 1s), rclcpp::FutureReturnCode::SUCCESS);
  report(0);
  EXPECT_EQ(frames.size(), 2u); // Stop cancels an awaiting goal as well.
  executor.remove_node(bench); executor.remove_node(peer);
  rclcpp::shutdown();
}
