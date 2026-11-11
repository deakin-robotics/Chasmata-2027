#include <chrono>
#include <map>
#include <thread>
#include <gtest/gtest.h>
#include <rclcpp/rclcpp.hpp>
#include <rclcpp_action/rclcpp_action.hpp>
#include <control_msgs/action/follow_joint_trajectory.hpp>
#include <controller_manager_msgs/srv/list_controllers.hpp>
#include <dcr_arm_driver/msg/direct_drive.hpp>
#include <dcr_arm_driver/srv/arm_handoff.hpp>
#include <dcr_arm_driver/srv/arm_trajectory_gate.hpp>
#include <sensor_msgs/msg/joy.hpp>
#include <std_msgs/msg/bool.hpp>
#include <std_msgs/msg/string.hpp>
#include <std_msgs/msg/u_int8.hpp>
#include <telemetry_interfaces/msg/arm_control_status.hpp>
#include <telemetry_interfaces/msg/fma_state.hpp>
#include "rover/rover_node.hpp"
using namespace std::chrono_literals;
using Trajectory = control_msgs::action::FollowJointTrajectory;
using Handoff = dcr_arm_driver::srv::ArmHandoff;
using List = controller_manager_msgs::srv::ListControllers;
using Status = telemetry_interfaces::msg::ArmControlStatus;
using ServerGoal = rclcpp_action::ServerGoalHandle<Trajectory>;

TEST(PositionArmBackend, HandoffsGateGoalsAndPreserveWristOwnership)
{
  int argc = 0; rclcpp::init(argc, nullptr);
  rclcpp::NodeOptions options;
  options.parameter_overrides({rclcpp::Parameter("arm_backend", "real"),
    rclcpp::Parameter("arm_manual_speed_rpm", std::vector<double>(6, 1.0))});
  auto rover = rover::make_rover_node(options);
  auto driver = std::make_shared<rclcpp::Node>("position_fake_driver");
  auto request = driver->create_publisher<std_msgs::msg::String>("/fma/arm/request", 10);
  auto joy = driver->create_publisher<sensor_msgs::msg::Joy>("/arm/joy", 10);
  auto lock = driver->create_publisher<std_msgs::msg::Bool>("/arm/orientation_lock", 10);
  auto publisher = driver->create_publisher<Status>("/arm/control/status", 10);
  Status status;
  status.hardware_active = status.estop_clear = status.feedback_fresh = status.motor_status_safe = true;
  status.controller_ready = status.direct_ready = true;
  status.joint_names = {"base_joint", "shoulder_joint", "elbow_joint", "yaw_joint", "pitch_joint", "roll_joint"};
  status.joint_can_ids = {1, 2, 3, 4, 5, 6}; status.joint_max_velocity_rpm = {10, 10, 10, 10, 10, 10};
  status.direct_request_ids = {0, 0, 0, 0, 0, 0};
  bool controller_active = true;
  auto manager = driver->create_service<List>("/controller_manager/list_controllers",
    [&](const List::Request::SharedPtr, List::Response::SharedPtr response) {
      controller_manager_msgs::msg::ControllerState item;
      item.name = "arm_real_controller"; item.state = controller_active ? "active" : "inactive";
      response->controller.push_back(item);
    });
  bool accept_handoff = true;
  auto handoff = driver->create_service<Handoff>("/arm/control/handoff",
    [&](const Handoff::Request::SharedPtr req, Handoff::Response::SharedPtr response) {
      response->success = accept_handoff;
      if (response->success) {
        status.control_owner = req->mode; std::fill(status.direct_request_ids.begin(), status.direct_request_ids.end(), 0);
      }
    });
  unsigned hold_requests = 0, enable_requests = 0;
  auto gate = driver->create_service<dcr_arm_driver::srv::ArmTrajectoryGate>("/arm/control/trajectory_gate",
    [&](const dcr_arm_driver::srv::ArmTrajectoryGate::Request::SharedPtr req,
       dcr_arm_driver::srv::ArmTrajectoryGate::Response::SharedPtr response) {
      if (req->enable) ++enable_requests; else ++hold_requests;
      response->success = true;
    });
  std::map<uint32_t, double> commands;
  auto command_sub = driver->create_subscription<dcr_arm_driver::msg::DirectDrive>("/arm/direct_drive", 32,
    [&](const dcr_arm_driver::msg::DirectDrive & msg) {
      commands[msg.id] = msg.value;
      for (size_t i = 0; i < status.joint_can_ids.size(); ++i)
        if (status.joint_can_ids[i] == msg.id) status.direct_request_ids[i] = msg.request_id;
    });
  uint8_t ownership = 0;
  auto ownership_sub = driver->create_subscription<std_msgs::msg::UInt8>("/arm/position/ownership", 10,
    [&](const std_msgs::msg::UInt8 & msg) { ownership = msg.data; });
  telemetry_interfaces::msg::FmaState fma;
  auto fma_sub = driver->create_subscription<telemetry_interfaces::msg::FmaState>("/fma/state", rclcpp::QoS(1).reliable().transient_local(),
    [&](const telemetry_interfaces::msg::FmaState & msg) { fma = msg; });
  std::shared_ptr<ServerGoal> forwarded;
  auto action = rclcpp_action::create_server<Trajectory>(driver, "/arm_real_controller/follow_joint_trajectory",
    [](const rclcpp_action::GoalUUID &, std::shared_ptr<const Trajectory::Goal>) { return rclcpp_action::GoalResponse::ACCEPT_AND_EXECUTE; },
    [](const std::shared_ptr<ServerGoal>) { return rclcpp_action::CancelResponse::ACCEPT; },
    [&](const std::shared_ptr<ServerGoal> goal) { forwarded = goal; });
  auto timer = driver->create_wall_timer(20ms, [&] {
    publisher->publish(status);
    if (forwarded && forwarded->is_canceling()) { forwarded->canceled(std::make_shared<Trajectory::Result>()); forwarded.reset(); }
  });
  auto trajectory = rclcpp_action::create_client<Trajectory>(driver, "/arm_controller/follow_joint_trajectory");
  rclcpp::executors::SingleThreadedExecutor executor; executor.add_node(rover); executor.add_node(driver);
  const auto wait = [&](const std::function<bool()> & condition, std::chrono::milliseconds duration) {
    const auto end = std::chrono::steady_clock::now() + duration;
    while (std::chrono::steady_clock::now() < end) {
      executor.spin_some(); if (condition()) return true; std::this_thread::sleep_for(5ms);
    }
    return false;
  };
  ASSERT_TRUE(wait([&] { return request->get_subscription_count() > 0 && trajectory->action_server_is_ready(); }, 2s));
  Trajectory::Goal premature;
  premature.trajectory.joint_names = {"base_joint", "shoulder_joint", "elbow_joint"};
  premature.trajectory.points.emplace_back();
  auto rejected_before_mode = trajectory->async_send_goal(premature);
  ASSERT_TRUE(wait([&] { return rejected_before_mode.wait_for(0s) == std::future_status::ready; }, 1s));
  EXPECT_EQ(rejected_before_mode.get(), nullptr);
  std_msgs::msg::String mode; mode.data = "POSITION"; request->publish(mode);
  ASSERT_TRUE(wait([&] { return fma.arm.confirmed == "POSITION"; }, 3s));
  ASSERT_EQ(status.control_owner, Handoff::Request::POSITION_UNLOCKED);
  ASSERT_TRUE(wait([&] { return ownership == 1; }, 1s));
  Trajectory::Goal goal; goal.trajectory.joint_names = {"base_joint", "shoulder_joint", "elbow_joint"};
  trajectory_msgs::msg::JointTrajectoryPoint point; point.positions = {0.1, 0.1, 0.1}; point.time_from_start.sec = 1;
  goal.trajectory.points.push_back(point);
  auto first = trajectory->async_send_goal(goal);
  ASSERT_TRUE(wait([&] { return first.wait_for(0s) == std::future_status::ready; }, 2s));
  ASSERT_NE(first.get(), nullptr);
  ASSERT_TRUE(wait([&] { return forwarded != nullptr; }, 2s));
  for (const auto * tolerances : {&forwarded->get_goal()->path_tolerance, &forwarded->get_goal()->goal_tolerance}) {
    ASSERT_EQ(tolerances->size(), 3u);
    for (const auto & tolerance : *tolerances) {
      EXPECT_TRUE(tolerance.name == "yaw_joint" || tolerance.name == "pitch_joint" || tolerance.name == "roll_joint");
      EXPECT_EQ(tolerance.position, -1.0);
      EXPECT_EQ(tolerance.velocity, -1.0);
      EXPECT_EQ(tolerance.acceleration, -1.0);
    }
  }
  EXPECT_GT(hold_requests, 0u);
  commands.clear(); sensor_msgs::msg::Joy input; input.axes = std::vector<float>(10, 0); input.buttons = std::vector<int32_t>(12, 0);
  input.axes[6] = 1; joy->publish(input);
  ASSERT_TRUE(wait([&] { return commands.count(4) && commands[4] == 1.0; }, 1s));
  EXPECT_EQ(commands.count(1), 0u); EXPECT_EQ(commands.count(2), 0u); EXPECT_EQ(commands.count(3), 0u);
  std_msgs::msg::Bool locked; locked.data = true; lock->publish(locked);
  ASSERT_TRUE(wait([&] { return !forwarded && status.control_owner == Handoff::Request::POSITION_LOCKED && fma.arm.confirmed == "POSITION"; }, 3s));
  wait([] { return false; }, 300ms);
  EXPECT_EQ(ownership, 2u);
  auto invalid = trajectory->async_send_goal(goal);
  ASSERT_TRUE(wait([&] { return invalid.wait_for(0s) == std::future_status::ready; }, 1s));
  EXPECT_EQ(invalid.get(), nullptr);
  goal.trajectory.joint_names = status.joint_names; goal.trajectory.points[0].positions.resize(6, 0.1);
  auto full = trajectory->async_send_goal(goal);
  ASSERT_TRUE(wait([&] { return full.wait_for(0s) == std::future_status::ready; }, 1s));
  auto handle = full.get(); ASSERT_NE(handle, nullptr);
  ASSERT_TRUE(wait([&] { return forwarded != nullptr; }, 1s));
  EXPECT_TRUE(forwarded->get_goal()->path_tolerance.empty());
  EXPECT_TRUE(forwarded->get_goal()->goal_tolerance.empty());
  auto cancel = trajectory->async_cancel_goal(handle);
  ASSERT_TRUE(wait([&] { return cancel.wait_for(0s) == std::future_status::ready; }, 2s));
  ASSERT_TRUE(wait([&] { return forwarded == nullptr; }, 2s));
  mode.data = "MANUAL"; request->publish(mode);
  ASSERT_TRUE(wait([&] { return fma.arm.confirmed == "MANUAL"; }, 3s));
  EXPECT_EQ(status.control_owner, Handoff::Request::MANUAL);
  accept_handoff = false; mode.data = "POSITION"; request->publish(mode);
  ASSERT_TRUE(wait([&] { return fma.arm.rejected == "POSITION"; }, 4s));
  EXPECT_EQ(fma.arm.confirmed, "MANUAL");
  accept_handoff = true; request->publish(mode);
  ASSERT_TRUE(wait([&] { return fma.arm.confirmed == "POSITION"; }, 3s));
  locked.data = false; lock->publish(locked); mode.data = "MANUAL"; request->publish(mode);
  ASSERT_TRUE(wait([&] { return fma.arm.confirmed == "MANUAL"; }, 4s));
  mode.data = "POSITION"; request->publish(mode);
  ASSERT_TRUE(wait([&] { return fma.arm.confirmed == "POSITION"; }, 3s));
  goal.trajectory.joint_names = {"base_joint", "shoulder_joint", "elbow_joint"};
  goal.trajectory.points[0].positions.resize(3, 0.1);
  size_t feedback_count = 0;
  rclcpp_action::Client<Trajectory>::SendGoalOptions goal_options;
  goal_options.feedback_callback = [&](auto, const std::shared_ptr<const Trajectory::Feedback>) { ++feedback_count; };
  auto successful = trajectory->async_send_goal(goal, goal_options);
  ASSERT_TRUE(wait([&] { return successful.wait_for(0s) == std::future_status::ready && forwarded; }, 2s));
  auto successful_handle = successful.get(); ASSERT_NE(successful_handle, nullptr);
  wait([] { return false; }, 200ms);
  forwarded->publish_feedback(std::make_shared<Trajectory::Feedback>());
  forwarded->succeed(std::make_shared<Trajectory::Result>()); forwarded.reset();
  auto result = trajectory->async_get_result(successful_handle);
  ASSERT_TRUE(wait([&] { return result.wait_for(0s) == std::future_status::ready; }, 2s));
  EXPECT_EQ(result.get().code, rclcpp_action::ResultCode::SUCCEEDED);
  EXPECT_GT(feedback_count, 0u);
  EXPECT_GT(enable_requests, 0u);
  controller_active = false;
  ASSERT_TRUE(wait([&] { return fma.arm.confirmed.empty(); }, 2s));
  auto unavailable = trajectory->async_send_goal(goal);
  ASSERT_TRUE(wait([&] { return unavailable.wait_for(0s) == std::future_status::ready; }, 1s));
  EXPECT_EQ(unavailable.get(), nullptr);
  executor.remove_node(driver); executor.remove_node(rover); rclcpp::shutdown();
}
