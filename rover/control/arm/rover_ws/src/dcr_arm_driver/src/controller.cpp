#include "dcr_arm_driver/controller.hpp"

#include <algorithm>
#include <cmath>

namespace dcr_arm_driver {

Controller::Controller() : Node("arm_controller") {
  // Initialize state
  current_joints_.fill(0.0f);
  joint_speeds_.fill(0.0f);

  // Define joint limits (in degrees)
  joint_limits_[0] = {-185.0f, 185.0f};   // Joint 1
  joint_limits_[1] = {-5.0f, 185.0f};     // Joint 2
  joint_limits_[2] = {-5.0f, 275.0f};     // Joint 3
  joint_limits_[3] = {-95.0f, 185.0f};    // Joint 4
  joint_limits_[4] = {-5.0f, 215.0f};     // Joint 5
  joint_limits_[5] = {-185.0f, 185.0f};   // Joint 6

  // Create motor instance
  motor_ = std::make_unique<Motor>();

  // Publishers
  can_tx_pub_ =
      this->create_publisher<can_msgs::msg::Frame>("socketcan_bridge/tx", 20);
  stat1_pub_ = this->create_publisher<arm_interfaces::msg::MotorStat1>(
      "/motor_stat_1", 15);
  stat2_pub_ = this->create_publisher<arm_interfaces::msg::MotorStat2>(
      "/motor_stat_2", 15);
  viz_pub_ =
      this->create_publisher<sensor_msgs::msg::JointState>("/joint_states", 15);

  // Subscribers
  joint_cmd_sub_ = this->create_subscription<sensor_msgs::msg::JointState>(
      "/joint_commands", 10,
      std::bind(&Controller::joint_command_callback, this,
                std::placeholders::_1));
  can_rx_sub_ = this->create_subscription<can_msgs::msg::Frame>(
      "socketcan_bridge/rx", 20,
      std::bind(&Controller::can_rx_callback, this, std::placeholders::_1));
  estop_sub_ = this->create_subscription<std_msgs::msg::Bool>(
      "/estop", 10,
      std::bind(&Controller::estop_callback, this, std::placeholders::_1));

  // Timers
  stat_timer_ = this->create_wall_timer(
      std::chrono::milliseconds(500),
      std::bind(&Controller::stat_timer_callback, this));
  viz_timer_ = this->create_wall_timer(
      std::chrono::milliseconds(50),
      std::bind(&Controller::viz_timer_callback, this));

  // Parameter callback
  param_callback_handle_ = this->add_on_set_parameters_callback(
      std::bind(&Controller::parameter_callback, this, std::placeholders::_1));

  // Initialize all motors to home
  for (int i = 0; i < NUM_JOINTS; ++i) {
    auto cmd = motor_->set_home(i + 1);
    can_tx_pub_->publish(cmd);
  }

  RCLCPP_INFO(this->get_logger(), "ARM Controller initialized");
}

void Controller::joint_command_callback(
    const sensor_msgs::msg::JointState& msg) {
  // msg.position contains angles in radians
  // msg.velocity contains speeds (optional)

  if (msg.position.size() != NUM_JOINTS) {
    RCLCPP_WARN(this->get_logger(),
                "Received joint command with %zu joints, expected %d",
                msg.position.size(), NUM_JOINTS);
    return;
  }

  // Extract velocities if provided, otherwise use defaults
  if (!msg.velocity.empty()) {
    for (int i = 0; i < NUM_JOINTS; ++i) {
      joint_speeds_[i] = msg.velocity[i];
    }
  }

  // Convert radians to degrees and send CAN commands
  for (int i = 0; i < NUM_JOINTS; ++i) {
    float angle_deg = msg.position[i] * 57.2958f;  // rad to deg

    // Clamp to limits
    angle_deg = std::clamp(angle_deg, joint_limits_[i].min,
                           joint_limits_[i].max);

    RCLCPP_DEBUG(this->get_logger(), "Motor %d: %.2f deg", i + 1, angle_deg);

    auto cmd = motor_->position_control(i + 1, angle_deg);
    can_tx_pub_->publish(cmd);
  }
}

void Controller::can_rx_callback(const can_msgs::msg::Frame& msg) {
  // Status 1: motor state (temp, current, speed, angle)
  if (msg.data[0] == 0xA4) {
    auto motor_stat = motor_->read_status_1(msg);

    if (motor_stat.id >= 1 && motor_stat.id <= NUM_JOINTS) {
      current_joints_[motor_stat.id - 1] = to_signed_angle(motor_stat.angle);
    }

    stat1_pub_->publish(motor_stat);

    RCLCPP_DEBUG(this->get_logger(),
                 "Motor %ld: temp=%.1f°C, current=%.3f A, speed=%.2f rpm, "
                 "angle=%.2f°",
                 motor_stat.id, static_cast<float>(motor_stat.temp),
                 motor_stat.current, motor_stat.speed, motor_stat.angle);
  }
  // Status 2: voltage, current, mode, fault
  else if (msg.data[0] == 0xAE) {
    auto motor_stat = motor_->read_status_2(msg);
    stat2_pub_->publish(motor_stat);

    RCLCPP_DEBUG(this->get_logger(),
                 "Motor %ld: busv=%.2f V, busc=%.2f A, mode=%s, %s",
                 motor_stat.id, motor_stat.busv, motor_stat.busc,
                 motor_stat.mode.c_str(), motor_stat.fault.c_str());
  }
}

void Controller::estop_callback(const std_msgs::msg::Bool& msg) {
  if (msg.data) {
    RCLCPP_WARN(this->get_logger(), "E-STOP triggered! Stopping all motors");

    // Send zero speed to all joints
    for (int i = 0; i < NUM_JOINTS; ++i) {
      auto cmd = motor_->speed_control(i + 1, 0.0f);
      can_tx_pub_->publish(cmd);
    }
  }
}

rcl_interfaces::msg::SetParametersResult Controller::parameter_callback(
    const std::vector<rclcpp::Parameter>& params) {
  rcl_interfaces::msg::SetParametersResult result;
  result.successful = true;

  for (const auto& param : params) {
    if (param.get_name() == "joint_limits") {
      // Could implement dynamic joint limit updates here
      RCLCPP_INFO(this->get_logger(), "Joint limits updated");
    }
  }

  return result;
}

void Controller::stat_timer_callback() {
  // Request status 1 and 2 from all motors
  auto stat1_req = motor_->send_status_1();
  auto stat2_req = motor_->send_status_2();

  can_tx_pub_->publish(stat1_req);
  can_tx_pub_->publish(stat2_req);
}

void Controller::viz_timer_callback() {
  // Publish joint states for visualization
  auto msg = std::make_unique<sensor_msgs::msg::JointState>();
  msg->header.stamp = this->now();
  msg->name = {"base_joint", "shoulder_joint", "elbow_joint", "wrist_joint_1",
               "wrist_joint_2", "wrist_joint_3"};

  // Convert degrees to radians
  for (int i = 0; i < NUM_JOINTS; ++i) {
    msg->position.push_back(current_joints_[i] * 0.0174533f);
  }

  viz_pub_->publish(std::move(msg));
}

float Controller::to_signed_angle(float angle) {
  if (angle > 180.0f) {
    angle -= 360.0f;
  }
  return angle;
}

bool Controller::check_joint_limits(int joint_id, float speed) {
  if (joint_id < 1 || joint_id > NUM_JOINTS) {
    return false;
  }

  int idx = joint_id - 1;
  float current = current_joints_[idx];
  float min_limit = joint_limits_[idx].min + JOINT_LIMIT_BUFFER;
  float max_limit = joint_limits_[idx].max - JOINT_LIMIT_BUFFER;

  if (current <= min_limit && speed < 0) {
    RCLCPP_WARN(this->get_logger(), "Motor %d at min limit, blocking negative speed",
                 joint_id);
    return false;
  }

  if (current >= max_limit && speed > 0) {
    RCLCPP_WARN(this->get_logger(), "Motor %d at max limit, blocking positive speed",
                 joint_id);
    return false;
  }

  return true;
}

}  // namespace dcr_arm_driver