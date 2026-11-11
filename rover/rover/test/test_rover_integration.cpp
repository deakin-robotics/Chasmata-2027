#include <algorithm>
#include <chrono>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include <control_msgs/action/follow_joint_trajectory.hpp>
#include <gtest/gtest.h>
#include <rclcpp/executors/single_threaded_executor.hpp>
#include <rclcpp_action/rclcpp_action.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <sensor_msgs/msg/joy.hpp>
#include <std_msgs/msg/bool.hpp>
#include <std_msgs/msg/empty.hpp>
#include <std_msgs/msg/string.hpp>
#include <telemetry_interfaces/msg/fma_state.hpp>
#include <trajectory_msgs/msg/joint_trajectory_point.hpp>

#include "rover/rover_node.hpp"
#include "rover/drive_backend.hpp"

namespace
{
using namespace std::chrono_literals;
using Trajectory = control_msgs::action::FollowJointTrajectory;

class RoverIntegrationTest : public ::testing::Test
{
protected:
  static void SetUpTestSuite()
  {
    int argc = 0;
    rclcpp::init(argc, nullptr);
  }

  static void TearDownTestSuite() { rclcpp::shutdown(); }

  void SetUp() override
  {
    rover_ = make_rover();
    client_ = std::make_shared<rclcpp::Node>("rover_integration_client");
    command_publisher_ = client_->create_publisher<sensor_msgs::msg::JointState>("/arm/joint_commands", 10);
    joy_publisher_ = client_->create_publisher<sensor_msgs::msg::Joy>("/arm/joy", 10);
    lock_publisher_ = client_->create_publisher<std_msgs::msg::Bool>("/arm/orientation_lock", 10);
    arm_mode_publisher_ = client_->create_publisher<std_msgs::msg::String>("/fma/arm/request", 10);
    drive_mode_publisher_ = client_->create_publisher<std_msgs::msg::String>("/fma/drive/request", 10);
    drive_joy_publisher_ = client_->create_publisher<sensor_msgs::msg::Joy>("/drive/joy", 10);
    fma_subscription_ = client_->create_subscription<telemetry_interfaces::msg::FmaState>("/fma/state",
      rclcpp::QoS(1).reliable().transient_local(), [this](telemetry_interfaces::msg::FmaState::SharedPtr message) {
        fma_.push_back(*message);
      });
    joint_subscription_ = client_->create_subscription<sensor_msgs::msg::JointState>("/arm/joint_states", 10,
      [this](sensor_msgs::msg::JointState::SharedPtr message) { joints_.push_back(*message); });
    heartbeat_subscription_ = client_->create_subscription<std_msgs::msg::Empty>("/rover/heartbeat", 10,
      [this](std_msgs::msg::Empty::SharedPtr) { ++heartbeats_; });
    trajectory_client_ = rclcpp_action::create_client<Trajectory>(client_, "/arm_controller/follow_joint_trajectory");
    executor_.add_node(rover_);
    executor_.add_node(client_);
    ASSERT_TRUE(wait_for([this] { return !fma_.empty() && !joints_.empty() && heartbeats_ > 0; }, 2s));
    ASSERT_TRUE(trajectory_client_->wait_for_action_server(2s));
  }

  virtual std::shared_ptr<rclcpp::Node> make_rover() { return rover::make_rover_node(); }

  void TearDown() override
  {
    executor_.remove_node(client_);
    if (rover_) executor_.remove_node(rover_);
    client_.reset();
    rover_.reset();
  }

  bool wait_for(const std::function<bool()> & predicate, std::chrono::milliseconds timeout)
  {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    while (std::chrono::steady_clock::now() < deadline) {
      executor_.spin_some();
      if (predicate()) return true;
      std::this_thread::sleep_for(10ms);
    }
    executor_.spin_some();
    return predicate();
  }

  const telemetry_interfaces::msg::FmaState & latest_fma() const { return fma_.back(); }
  const sensor_msgs::msg::JointState & latest_joints() const { return joints_.back(); }
  double joint(const sensor_msgs::msg::JointState & state, const std::string & name) const
  {
    const auto found = std::find(state.name.begin(), state.name.end(), name);
    return state.position.at(static_cast<size_t>(std::distance(state.name.begin(), found)));
  }

  void request_arm_mode(const std::string & mode)
  {
    std_msgs::msg::String message;
    message.data = mode;
    arm_mode_publisher_->publish(message);
  }

  rclcpp::executors::SingleThreadedExecutor executor_;
  std::shared_ptr<rclcpp::Node> rover_, client_;
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr command_publisher_;
  rclcpp::Publisher<sensor_msgs::msg::Joy>::SharedPtr joy_publisher_;
  rclcpp::Publisher<std_msgs::msg::Bool>::SharedPtr lock_publisher_;
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr arm_mode_publisher_;
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr drive_mode_publisher_;
  rclcpp::Publisher<sensor_msgs::msg::Joy>::SharedPtr drive_joy_publisher_;
  rclcpp::Subscription<telemetry_interfaces::msg::FmaState>::SharedPtr fma_subscription_;
  rclcpp::Subscription<sensor_msgs::msg::JointState>::SharedPtr joint_subscription_;
  rclcpp::Subscription<std_msgs::msg::Empty>::SharedPtr heartbeat_subscription_;
  rclcpp_action::Client<Trajectory>::SharedPtr trajectory_client_;
  std::vector<telemetry_interfaces::msg::FmaState> fma_;
  std::vector<sensor_msgs::msg::JointState> joints_;
  size_t heartbeats_{0};
};

// The default drive backend retains pending, delayed confirmation, and rejection behavior.
TEST_F(RoverIntegrationTest, DriveModesPreserveMockAcknowledgementAndRejection)
{
  std_msgs::msg::String request;
  request.data = " manual ";
  const auto start = std::chrono::steady_clock::now();
  drive_mode_publisher_->publish(request);
  ASSERT_TRUE(wait_for([this] { return latest_fma().drive.pending == "MANUAL"; }, 1s));
  EXPECT_TRUE(latest_fma().drive.confirmed.empty());
  ASSERT_TRUE(wait_for([this] { return latest_fma().drive.confirmed == "MANUAL"; }, 1s));
  EXPECT_GE(std::chrono::steady_clock::now() - start, 150ms);
  EXPECT_TRUE(latest_fma().drive.pending.empty());

  request.data = "INVALID";
  drive_mode_publisher_->publish(request);
  ASSERT_TRUE(wait_for([this] { return latest_fma().drive.rejected == "INVALID"; }, 1s));
  EXPECT_EQ(latest_fma().drive.confirmed, "MANUAL");
  ASSERT_TRUE(wait_for([this] { return latest_fma().drive.rejected.empty(); }, 1s));

  request.data = "VELOCITY";
  drive_mode_publisher_->publish(request);
  ASSERT_TRUE(wait_for([this] { return latest_fma().drive.pending == "VELOCITY"; }, 1s));
  request.data = "INVALID";
  drive_mode_publisher_->publish(request);
  ASSERT_TRUE(wait_for([this] { return latest_fma().drive.rejected == "INVALID"; }, 1s));
  wait_for([] { return false; }, 300ms);
  EXPECT_EQ(latest_fma().drive.confirmed, "MANUAL");
  EXPECT_TRUE(latest_fma().drive.pending.empty());
}

class TestDriveBackend : public rover::DriveBackend
{
public:
  void request_mode(const std::string & mode) override { requested = mode; result.reset(); }
  void cancel_mode_request() override { requested.clear(); result.reset(); }
  std::optional<bool> take_mode_result() override { auto value = result; result.reset(); return value; }
  void on_joy(const sensor_msgs::msg::Joy & joy) override { last_joy = joy; ++joy_count; }
  std::string requested;
  std::optional<bool> result;
  sensor_msgs::msg::Joy last_joy;
  size_t joy_count{0};
};

class InjectedDriveIntegrationTest : public RoverIntegrationTest
{
protected:
  std::shared_ptr<rclcpp::Node> make_rover() override
  {
    auto backend = std::make_unique<TestDriveBackend>();
    drive_ = backend.get();
    return rover::make_rover_node(std::move(backend));
  }
  TestDriveBackend * drive_{};
};

// Rover Control routes validated input and waits for the injected backend's result.
TEST_F(InjectedDriveIntegrationTest, RoutesRequestsAndJoyAndHandlesBackendResults)
{
  std_msgs::msg::String request;
  request.data = "MANUAL";
  drive_mode_publisher_->publish(request);
  ASSERT_TRUE(wait_for([this] { return latest_fma().drive.pending == "MANUAL"; }, 1s));
  EXPECT_EQ(drive_->requested, "MANUAL");
  wait_for([] { return false; }, 250ms);
  EXPECT_TRUE(latest_fma().drive.confirmed.empty());
  drive_->result = true;
  ASSERT_TRUE(wait_for([this] { return latest_fma().drive.confirmed == "MANUAL"; }, 1s));

  sensor_msgs::msg::Joy joy;
  joy.axes = {0.5F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F};
  joy.buttons = {0, 1};
  drive_joy_publisher_->publish(joy);
  ASSERT_TRUE(wait_for([this] { return drive_->joy_count == 1; }, 1s));
  EXPECT_EQ(drive_->last_joy.axes, joy.axes);
  joy.axes[4] = -1.0F;
  drive_joy_publisher_->publish(joy);
  wait_for([] { return false; }, 200ms);
  EXPECT_EQ(drive_->joy_count, 1U);

  request.data = "VELOCITY";
  drive_mode_publisher_->publish(request);
  ASSERT_TRUE(wait_for([this] { return latest_fma().drive.pending == "VELOCITY"; }, 1s));
  drive_->result = false;
  ASSERT_TRUE(wait_for([this] { return latest_fma().drive.rejected == "VELOCITY"; }, 1s));
  EXPECT_EQ(latest_fma().drive.confirmed, "MANUAL");
  EXPECT_TRUE(latest_fma().drive.pending.empty());
}

// The node publishes heartbeat and joint states, applies limits, and acknowledges or rejects FMA requests.
TEST_F(RoverIntegrationTest, PublishesHeartbeatJointStateAndFmaAcknowledgement)
{
  EXPECT_EQ(latest_joints().name, std::vector<std::string>({"base_joint", "shoulder_joint", "elbow_joint", "yaw_joint", "pitch_joint", "roll_joint"}));
  sensor_msgs::msg::JointState command;
  command.name = {"base_joint", "shoulder_joint"};
  command.position = {0.4, 9.0};
  command_publisher_->publish(command);
  ASSERT_TRUE(wait_for([this] { return joint(latest_joints(), "base_joint") == 0.4; }, 1s));
  EXPECT_NEAR(joint(latest_joints(), "shoulder_joint"), 3.228859116, 1e-9);

  request_arm_mode("position");
  ASSERT_TRUE(wait_for([this] { return latest_fma().arm.pending == "POSITION"; }, 1s));
  ASSERT_TRUE(wait_for([this] { return latest_fma().arm.confirmed == "POSITION"; }, 1s));
  request_arm_mode("invalid");
  ASSERT_TRUE(wait_for([this] { return latest_fma().arm.rejected == "INVALID"; }, 1s));
}

// Manual joystick input moves the arm; Position wrist input works only when orientation is unlocked.
TEST_F(RoverIntegrationTest, AppliesManualAndUnlockedPositionJoystickMappings)
{
  request_arm_mode("MANUAL");
  ASSERT_TRUE(wait_for([this] { return latest_fma().arm.confirmed == "MANUAL"; }, 1s));
  const auto initial_base = joint(latest_joints(), "base_joint");
  sensor_msgs::msg::Joy joy;
  joy.axes.assign(10, 0.0F);
  joy.axes[0] = 1.0F;
  joy.buttons.assign(5, 0);
  joy_publisher_->publish(joy);
  ASSERT_TRUE(wait_for([this, initial_base] { return joint(latest_joints(), "base_joint") > initial_base; }, 1s));

  request_arm_mode("POSITION");
  ASSERT_TRUE(wait_for([this] { return latest_fma().arm.confirmed == "POSITION"; }, 1s));
  const auto before_yaw = joint(latest_joints(), "yaw_joint");
  joy.axes[0] = 0.0F;
  joy.axes[6] = 1.0F;
  joy_publisher_->publish(joy);
  ASSERT_TRUE(wait_for([this, before_yaw] { return joint(latest_joints(), "yaw_joint") > before_yaw; }, 1s));
  std_msgs::msg::Bool locked;
  locked.data = true;
  lock_publisher_->publish(locked);
  wait_for([] { return false; }, 100ms);
  const auto locked_yaw = joint(latest_joints(), "yaw_joint");
  joy_publisher_->publish(joy);
  wait_for([] { return false; }, 150ms);
  EXPECT_DOUBLE_EQ(joint(latest_joints(), "yaw_joint"), locked_yaw);
}

// Trajectories provide feedback, complete or cancel, and reject partial goals when orientation is locked.
TEST_F(RoverIntegrationTest, ValidatesExecutesAndCancelsTrajectories)
{
  auto make_goal = [](double seconds, double target) {
    Trajectory::Goal goal;
    goal.trajectory.joint_names = {"base_joint", "shoulder_joint", "elbow_joint"};
    trajectory_msgs::msg::JointTrajectoryPoint point;
    point.positions = {target, 0.2, 0.3};
    point.time_from_start.sec = static_cast<int32_t>(seconds);
    point.time_from_start.nanosec = static_cast<uint32_t>((seconds - static_cast<int>(seconds)) * 1e9);
    goal.trajectory.points.push_back(point);
    return goal;
  };
  size_t feedback_count = 0;
  rclcpp_action::Client<Trajectory>::SendGoalOptions options;
  options.feedback_callback = [&feedback_count](auto, const std::shared_ptr<const Trajectory::Feedback>) { ++feedback_count; };
  auto goal_future = trajectory_client_->async_send_goal(make_goal(0.2, 0.3), options);
  ASSERT_TRUE(wait_for([&goal_future] { return goal_future.wait_for(0s) == std::future_status::ready; }, 1s));
  auto goal_handle = goal_future.get();
  ASSERT_NE(goal_handle, nullptr);
  auto result_future = trajectory_client_->async_get_result(goal_handle);
  ASSERT_TRUE(wait_for([&result_future] { return result_future.wait_for(0s) == std::future_status::ready; }, 2s));
  EXPECT_EQ(result_future.get().code, rclcpp_action::ResultCode::SUCCEEDED);
  EXPECT_GT(feedback_count, 0U);
  ASSERT_TRUE(wait_for([this] {
    const auto & state = latest_joints();
    return joint(state, "base_joint") == 0.3 &&
      state.velocity.size() == state.name.size() &&
      state.velocity[0] == 0.0 && state.velocity[1] == 0.0 && state.velocity[2] == 0.0;
  }, 1s));

  auto long_goal = trajectory_client_->async_send_goal(make_goal(4.0, 0.6));
  ASSERT_TRUE(wait_for([&long_goal] { return long_goal.wait_for(0s) == std::future_status::ready; }, 1s));
  auto long_handle = long_goal.get();
  ASSERT_NE(long_handle, nullptr);
  const auto heartbeat_count = heartbeats_;
  ASSERT_TRUE(wait_for([this, heartbeat_count] { return heartbeats_ > heartbeat_count; }, 2s));
  auto cancel_future = trajectory_client_->async_cancel_goal(long_handle);
  ASSERT_TRUE(wait_for([&cancel_future] { return cancel_future.wait_for(0s) == std::future_status::ready; }, 1s));
  auto cancelled_result = trajectory_client_->async_get_result(long_handle);
  ASSERT_TRUE(wait_for([&cancelled_result] { return cancelled_result.wait_for(0s) == std::future_status::ready; }, 2s));
  EXPECT_EQ(cancelled_result.get().code, rclcpp_action::ResultCode::CANCELED);
  ASSERT_TRUE(wait_for([this] {
    const auto & state = latest_joints();
    return state.velocity.size() == state.name.size() &&
      state.velocity[0] == 0.0 && state.velocity[1] == 0.0 && state.velocity[2] == 0.0;
  }, 1s));

  std_msgs::msg::Bool locked;
  locked.data = true;
  lock_publisher_->publish(locked);
  auto invalid_goal = trajectory_client_->async_send_goal(make_goal(0.2, 0.1));
  ASSERT_TRUE(wait_for([&invalid_goal] { return invalid_goal.wait_for(0s) == std::future_status::ready; }, 1s));
  auto invalid_handle = invalid_goal.get();
  ASSERT_NE(invalid_handle, nullptr);
  auto invalid_result = trajectory_client_->async_get_result(invalid_handle);
  ASSERT_TRUE(wait_for([&invalid_result] { return invalid_result.wait_for(0s) == std::future_status::ready; }, 1s));
  EXPECT_EQ(invalid_result.get().code, rclcpp_action::ResultCode::ABORTED);
}

// Destroying the node stops active and queued trajectory workers promptly.
TEST_F(RoverIntegrationTest, StopsTrajectoryWorkersWhenNodeIsDestroyed)
{
  Trajectory::Goal goal;
  goal.trajectory.joint_names = {"base_joint"};
  trajectory_msgs::msg::JointTrajectoryPoint point;
  point.positions = {0.6};
  point.time_from_start.sec = 30;
  goal.trajectory.points.push_back(point);
  auto first = trajectory_client_->async_send_goal(goal);
  ASSERT_TRUE(wait_for([&first] { return first.wait_for(0s) == std::future_status::ready; }, 2s));
  ASSERT_NE(first.get(), nullptr);
  auto second = trajectory_client_->async_send_goal(goal);
  ASSERT_TRUE(wait_for([&second] { return second.wait_for(0s) == std::future_status::ready; }, 2s));
  ASSERT_NE(second.get(), nullptr);
  ASSERT_TRUE(wait_for([this] { return joint(latest_joints(), "base_joint") > 0.0; }, 2s));
  executor_.remove_node(rover_);
  const auto start = std::chrono::steady_clock::now();
  rover_.reset();
  EXPECT_LT(std::chrono::steady_clock::now() - start, 2s);
}
}  // namespace
