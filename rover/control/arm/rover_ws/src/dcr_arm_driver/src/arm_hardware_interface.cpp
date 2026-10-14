#include "dcr_arm_driver/arm_hardware_interface.hpp"

#include <cmath>
#include <limits>
#include <optional>
#include <algorithm>

#include <pluginlib/class_list_macros.hpp>
#include <rclcpp/rclcpp.hpp>

namespace dcr_arm_driver {
namespace {

constexpr double TWO_PI = 6.28318530717958647692;
constexpr double PI = 3.14159265358979323846;
constexpr double DEGREES_TO_RADIANS = PI / 180.0;
constexpr double RPM_TO_RADIANS_PER_SECOND = TWO_PI / 60.0;

std::optional<double> normalize_encoder_angle(
    double angle_degrees, double lower_limit, double upper_limit,
    double reference_position) {
  double wrapped_angle = std::fmod(angle_degrees * DEGREES_TO_RADIANS, TWO_PI);
  if (wrapped_angle < 0.0) {
    wrapped_angle += TWO_PI;
  }

  const auto first_turn = static_cast<long>(
      std::ceil((lower_limit - wrapped_angle) / TWO_PI));
  const auto last_turn = static_cast<long>(
      std::floor((upper_limit - wrapped_angle) / TWO_PI));
  if (first_turn > last_turn) {
    return std::nullopt;
  }

  double closest_position = 0.0;
  double closest_distance = std::numeric_limits<double>::max();
  for (long turn = first_turn; turn <= last_turn; ++turn) {
    const double candidate = wrapped_angle + turn * TWO_PI;
    const double distance = std::abs(candidate - reference_position);
    if (distance < closest_distance) {
      closest_position = candidate;
      closest_distance = distance;
    }
  }
  return closest_position;
}

}  // namespace

// NEW SIGNATURE - use HardwareComponentInterfaceParams [1]
hardware_interface::CallbackReturn ArmHardwareInterface::on_init(
    const hardware_interface::HardwareComponentInterfaceParams& params) {
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Initializing...");

  // Call parent on_init with new Jazzy signature [6]
  if (hardware_interface::SystemInterface::on_init(params) !=
      hardware_interface::CallbackReturn::SUCCESS) {
    return hardware_interface::CallbackReturn::ERROR;
  }

  // Extract HardwareInfo from params
  const hardware_interface::HardwareInfo& info = params.hardware_info;

  // Read CAN interface name from URDF <param>
  if (info.hardware_parameters.count("can_interface") == 0) {
    RCLCPP_ERROR(rclcpp::get_logger("ArmHardwareInterface"),
                 "Missing 'can_interface' parameter");
    return hardware_interface::CallbackReturn::ERROR;
  }
  can_interface_ = info.hardware_parameters.at("can_interface");
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"),
              "CAN interface: %s", can_interface_.c_str());

  // Initialize joints from URDF
  joints_.clear();
  for (const auto& joint : info_.joints) {
    JointInfo joint_info;
    joint_info.name = joint.name;

    bool has_position_limits = false;
    for (const auto& command_interface : joint.command_interfaces) {
      if (command_interface.name != hardware_interface::HW_IF_POSITION) {
        continue;
      }
      try {
        joint_info.position_min = std::stod(command_interface.min);
        joint_info.position_max = std::stod(command_interface.max);
      } catch (const std::exception& e) {
        RCLCPP_ERROR(rclcpp::get_logger("ArmHardwareInterface"),
                     "Missing or invalid position limits for joint %s: %s",
                     joint.name.c_str(), e.what());
        return hardware_interface::CallbackReturn::ERROR;
      }
      has_position_limits = joint_info.position_min <= joint_info.position_max;
    }
    if (!has_position_limits) {
      // Keep compatibility with ros2_control descriptions that omit explicit
      // interface limits. The production arm URDF provides each joint's range.
      joint_info.position_min = -PI;
      joint_info.position_max = PI;
      RCLCPP_WARN(rclcpp::get_logger("ArmHardwareInterface"),
                  "No position interface limits for joint %s; using [-pi, pi] for encoder normalization",
                  joint.name.c_str());
    }

    // Read CAN ID for this joint from URDF
    std::string can_id_param = joint.name + "_can_id";
    if (info.hardware_parameters.count(can_id_param) == 0) {
      RCLCPP_ERROR(rclcpp::get_logger("ArmHardwareInterface"),
                   "Missing CAN ID parameter for joint: %s", joint.name.c_str());
      return hardware_interface::CallbackReturn::ERROR;
    }

    try {
      joint_info.can_id =
          std::stoul(info.hardware_parameters.at(can_id_param), nullptr, 0);
    } catch (const std::exception& e) {
      RCLCPP_ERROR(rclcpp::get_logger("ArmHardwareInterface"),
                   "Invalid CAN ID for joint %s: %s", joint.name.c_str(),
                   e.what());
      return hardware_interface::CallbackReturn::ERROR;
    }

    joints_.push_back(joint_info);
    RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"),
                "Initialized joint '%s' with CAN ID 0x%02X", joint.name.c_str(),
                joint_info.can_id);
  }

  // Create Motor driver instance
  motor_driver_ = std::make_unique<Motor>();

  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"),
              "ArmHardwareInterface initialized with %lu joints",
              joints_.size());

  return hardware_interface::CallbackReturn::SUCCESS;
}

// Rest of the implementation remains the same...

hardware_interface::CallbackReturn ArmHardwareInterface::on_configure(
    const rclcpp_lifecycle::State& /*previous_state*/) {
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Configuring...");
  node_ = this->get_node();
  ensure_estop_subscription(node_);
  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn ArmHardwareInterface::on_activate(
    const rclcpp_lifecycle::State& /*previous_state*/) {
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Activating...");

  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  active_ = false;

  // IMPORTANT: do NOT create a private node here. A node created inside a
  // ros2_control plugin is never added to any executor, so its subscription
  // callbacks (from /socketcan_bridge/rx and /arm/direct_drive) would never fire.
  // Instead, use the node that controller_manager already owns and spins.
  auto node = this->get_node();
  node_ = node;
  ensure_estop_subscription(node);

  // Talk to nobleo_socketcan_bridge. Its node is named "socketcan_bridge"
  // and it publishes received frames on "~/rx" (-> /socketcan_bridge/rx) and
  // sends frames arriving on "~/tx" (-> /socketcan_bridge/tx).
  can_pub_ = node->create_publisher<can_msgs::msg::Frame>(
      "/socketcan_bridge/tx", rclcpp::QoS(100));

  can_sub_ = node->create_subscription<can_msgs::msg::Frame>(
      "/socketcan_bridge/rx", rclcpp::QoS(100),
      [this](const can_msgs::msg::Frame& msg) {
        this->can_frame_callback(msg);
      });

  // Telemetry exposed from arm_interfaces (topic names match old motor_node)
  stat1_pub_ = node->create_publisher<arm_interfaces::msg::MotorStat1>(
      "/motor_stat_1", rclcpp::QoS(100));
  stat2_pub_ = node->create_publisher<arm_interfaces::msg::MotorStat2>(
      "/motor_stat_2", rclcpp::QoS(100));

  // Direct commands are latched per joint and sent by write(), so controller
  // positions cannot overwrite them on the next control iteration.
  direct_drive_sub_ = node->create_subscription<dcr_arm_driver::msg::DirectDrive>(
      "/arm/direct_drive", rclcpp::QoS(1),
      [this](const dcr_arm_driver::msg::DirectDrive& msg) {
        this->direct_drive_callback(msg);
      });

  for (auto& joint : joints_) {
    joint.direct_mode = dcr_arm_driver::msg::DirectDrive::CONTROLLER;
    joint.direct_value = 0.0;
    joint.has_position_feedback = false;
    joint.has_pending_status1 = false;
  }
  trajectory_goal_active_ = false;

  auto clear_fault_msg = motor_driver_->clr_faults();
  can_pub_->publish(clear_fault_msg);

  set_home_service_ = node->create_service<std_srvs::srv::Trigger>(
      "/arm/set_home",
      [this](const std_srvs::srv::Trigger::Request::SharedPtr /*request*/,
             std_srvs::srv::Trigger::Response::SharedPtr response) {
        std::lock_guard<std::mutex> lock(lifecycle_mutex_);
        if (!active_ || !can_pub_) {
          response->success = false;
          response->message = "Arm hardware is inactive";
          return;
        }
        if (estop_asserted_.load(std::memory_order_relaxed)) {
          response->success = false;
          response->message = "Cannot set home while E-stop is asserted";
          return;
        }
        if (trajectory_goal_active_) {
          response->success = false;
          response->message =
              "Cannot set home while a trajectory goal is active or canceling";
          return;
        }
        constexpr double kHomeToleranceRadians = 0.02;
        constexpr double kHomeVelocityTolerance = 0.05;
        for (const auto& joint : joints_) {
          if (joint.direct_mode !=
                  dcr_arm_driver::msg::DirectDrive::CONTROLLER ||
              !joint.has_position_feedback ||
              std::abs(joint.position) > kHomeToleranceRadians ||
              std::abs(joint.velocity) > kHomeVelocityTolerance ||
              std::abs(joint.last_position_command) >
                  kHomeToleranceRadians) {
            response->success = false;
            response->message =
                "Move every joint to its existing zero position, return direct drive to controller mode, and retry";
            return;
          }
        }

        for (auto& joint : joints_) {
          can_pub_->publish(motor_driver_->speed_control(joint.can_id, 0.0f));
          can_pub_->publish(motor_driver_->set_home(joint.can_id));
          joint.direct_mode = dcr_arm_driver::msg::DirectDrive::CONTROLLER;
          joint.direct_value = 0.0;
        }
        // Apply the interface reset from read(), on the control-manager thread,
        // rather than writing exported interfaces from this service callback.
        home_pending_ = true;
        response->success = true;
        response->message = "Home command sent; controller state will reset on the next read";
      });

  trajectory_status_sub_ = node->create_subscription<
      action_msgs::msg::GoalStatusArray>(
      "/arm_controller/follow_joint_trajectory/_action/status",
      rclcpp::QoS(1).transient_local(),
      [this](const action_msgs::msg::GoalStatusArray& msg) {
        this->trajectory_status_callback(msg);
      });

  active_ = true;
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Arm activated");
  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn ArmHardwareInterface::on_deactivate(
    const rclcpp_lifecycle::State& /*previous_state*/) {
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Deactivating...");
  deactivate_endpoints();
  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn ArmHardwareInterface::on_cleanup(
    const rclcpp_lifecycle::State& /*previous_state*/) {
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Cleaning up...");
  deactivate_endpoints();
  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn ArmHardwareInterface::on_shutdown(
    const rclcpp_lifecycle::State& /*previous_state*/) {
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Shutting down...");
  deactivate_endpoints();
  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn ArmHardwareInterface::on_error(
    const rclcpp_lifecycle::State& /*previous_state*/) {
  RCLCPP_ERROR(rclcpp::get_logger("ArmHardwareInterface"), "Error state");
  deactivate_endpoints();
  return hardware_interface::CallbackReturn::SUCCESS;
}

void ArmHardwareInterface::deactivate_endpoints() {
  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  active_ = false;
  // Stop every motor before dropping the publisher. Direct speed commands are
  // latched by the motor, so stopping callbacks alone would leave it moving.
  if (can_pub_ && motor_driver_) {
    for (const auto& joint : joints_) {
      can_pub_->publish(motor_driver_->speed_control(joint.can_id, 0.0f));
    }
  }
  direct_drive_sub_.reset();
  can_sub_.reset();
  set_home_service_.reset();
  trajectory_status_sub_.reset();
  stat1_pub_.reset();
  stat2_pub_.reset();
  can_pub_.reset();
}

void ArmHardwareInterface::ensure_estop_subscription(
    const rclcpp::Node::SharedPtr& node) {
  if (estop_sub_) {
    return;
  }

  // Keep this subscription alive across deactivation and cleanup so stop
  // changes are not missed while motion endpoints are torn down.
  estop_sub_ = node->create_subscription<std_msgs::msg::Bool>(
      "/estop", rclcpp::QoS(1), [this](const std_msgs::msg::Bool& msg) {
        estop_asserted_.store(msg.data, std::memory_order_relaxed);
        if (msg.data) {
          RCLCPP_WARN(rclcpp::get_logger("ArmHardwareInterface"),
                      "E-stop asserted; stopping arm motion");
        }
      });
}

std::vector<hardware_interface::StateInterface>
ArmHardwareInterface::export_state_interfaces() {
  std::vector<hardware_interface::StateInterface> state_interfaces;

  for (size_t i = 0; i < joints_.size(); ++i) {
    state_interfaces.emplace_back(hardware_interface::StateInterface(
        joints_[i].name, "position", &joints_[i].position));
    state_interfaces.emplace_back(hardware_interface::StateInterface(
        joints_[i].name, "velocity", &joints_[i].velocity));
  }

  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"),
              "Exported %lu state interfaces", state_interfaces.size());

  return state_interfaces;
}

std::vector<hardware_interface::CommandInterface>
ArmHardwareInterface::export_command_interfaces() {
  std::vector<hardware_interface::CommandInterface> command_interfaces;

  for (size_t i = 0; i < joints_.size(); ++i) {
    command_interfaces.emplace_back(hardware_interface::CommandInterface(
        joints_[i].name, "position", &joints_[i].position_command));
  }

  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"),
              "Exported %lu command interfaces", command_interfaces.size());

  return command_interfaces;
}

hardware_interface::return_type ArmHardwareInterface::read(
    const rclcpp::Time& /*time*/, const rclcpp::Duration& /*period*/) {
  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  if (home_pending_) {
    for (auto& joint : joints_) {
      joint.position = 0.0;
      joint.velocity = 0.0;
      joint.position_command = 0.0;
      joint.has_position_feedback = true;
      joint.has_pending_status1 = false;
    }
    home_pending_ = false;
  }

  for (auto& joint : joints_) {
    if (joint.has_pending_status1) {
      const auto position = normalize_encoder_angle(
          joint.pending_angle_degrees, joint.position_min, joint.position_max,
          joint.position);
      if (position) {
        joint.position = *position;
        if (!joint.has_position_feedback) {
          joint.position_command = *position;
          joint.has_position_feedback = true;
        }
      } else {
        RCLCPP_WARN_THROTTLE(
            rclcpp::get_logger("ArmHardwareInterface"), *node_->get_clock(),
            5000, "Encoder angle %.2f degrees for joint '%s' is outside its URDF limits",
            joint.pending_angle_degrees, joint.name.c_str());
      }
      joint.velocity = joint.pending_speed_rpm * RPM_TO_RADIANS_PER_SECOND;
      joint.has_pending_status1 = false;
    }
    if (!can_pub_) {
      continue;
    }
    auto status1_req = motor_driver_->send_status_1();
    status1_req.id = joint.can_id;
    can_pub_->publish(status1_req);

    auto status2_req = motor_driver_->send_status_2();
    status2_req.id = joint.can_id;
    can_pub_->publish(status2_req);
  }

  return hardware_interface::return_type::OK;
}

hardware_interface::return_type ArmHardwareInterface::write(
    const rclcpp::Time& /*time*/, const rclcpp::Duration& /*period*/) {
  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  if (!active_ || !can_pub_) {
    return hardware_interface::return_type::OK;
  }
  const bool estop_asserted = estop_asserted_.load(std::memory_order_relaxed);
  for (auto& joint : joints_) {
    if (can_pub_) {
      // Repeated zero-speed commands clear any motor motion command already in
      // flight while the E-stop is active. Do not send trajectory positions.
      can_msgs::msg::Frame cmd_msg;
      if (estop_asserted || !joint.has_position_feedback) {
        cmd_msg = motor_driver_->speed_control(joint.can_id, 0.0f);
      } else if (joint.direct_mode == dcr_arm_driver::msg::DirectDrive::SPEED) {
        cmd_msg = motor_driver_->speed_control(joint.can_id, joint.direct_value);
      } else if (joint.direct_mode == dcr_arm_driver::msg::DirectDrive::POSITION) {
        const double direct_position =
            std::clamp(joint.direct_value * DEGREES_TO_RADIANS,
                       joint.position_min, joint.position_max);
        cmd_msg = motor_driver_->position_control(
            joint.can_id, static_cast<float>(direct_position / DEGREES_TO_RADIANS));
      } else {
        const double command = std::isfinite(joint.position_command)
                                   ? std::clamp(joint.position_command,
                                                joint.position_min,
                                                joint.position_max)
                                   : joint.position;
        cmd_msg = motor_driver_->position_control(
            joint.can_id,
            static_cast<float>(command / DEGREES_TO_RADIANS));
        joint.last_position_command = command;
      }
      can_pub_->publish(cmd_msg);
    }
  }

  return hardware_interface::return_type::OK;
}

JointInfo* ArmHardwareInterface::find_joint(uint32_t can_id) {
  for (auto& joint : joints_) {
    if (joint.can_id == can_id) {
      return &joint;
    }
  }
  return nullptr;
}

void ArmHardwareInterface::can_frame_callback(
    const can_msgs::msg::Frame& msg) {
  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  if (msg.dlc < 8) {
    return;
  }

  JointInfo* joint = find_joint(msg.id);
  if (joint == nullptr) {
    return;
  }

  if (msg.data[0] == 0xA4) {
    // Status 1: temperature, current, speed, angle
    auto stat = motor_driver_->read_status_1(msg);
    // Stage feedback here. read() applies it to exported interfaces on the
    // controller-manager thread, avoiding concurrent writes to state handles.
    joint->pending_angle_degrees = stat.angle;
    joint->pending_speed_rpm = stat.speed;
    joint->has_pending_status1 = true;
    joint->temperature = stat.temp;
    if (stat1_pub_) {
      stat1_pub_->publish(stat);
    }
  } else if (msg.data[0] == 0xAE) {
    // Status 2: bus voltage, bus current, mode, faults
    auto stat = motor_driver_->read_status_2(msg);
    joint->bus_voltage = stat.busv;
    joint->bus_current = stat.busc;
    joint->mode = stat.mode;
    joint->fault = stat.fault;
    if (stat2_pub_) {
      stat2_pub_->publish(stat);
    }
  }
}

void ArmHardwareInterface::trajectory_status_callback(
    const action_msgs::msg::GoalStatusArray& msg) {
  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  trajectory_goal_active_ = std::any_of(
      msg.status_list.begin(), msg.status_list.end(),
      [](const action_msgs::msg::GoalStatus& status) {
        return status.status == action_msgs::msg::GoalStatus::STATUS_ACCEPTED ||
               status.status == action_msgs::msg::GoalStatus::STATUS_EXECUTING ||
               status.status == action_msgs::msg::GoalStatus::STATUS_CANCELING;
      });
}

void ArmHardwareInterface::direct_drive_callback(
    const dcr_arm_driver::msg::DirectDrive& msg) {
  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  if (!active_ || estop_asserted_.load(std::memory_order_relaxed)) {
    return;
  }

  JointInfo* joint = find_joint(msg.id);
  if (joint == nullptr) {
    return;
  }

  using DirectDrive = dcr_arm_driver::msg::DirectDrive;
  if (msg.mode != DirectDrive::CONTROLLER && msg.mode != DirectDrive::POSITION &&
      msg.mode != DirectDrive::SPEED) {
    RCLCPP_WARN(rclcpp::get_logger("ArmHardwareInterface"),
                "Ignoring invalid direct-drive mode: %u", msg.mode);
    return;
  }
  if (msg.mode != DirectDrive::CONTROLLER) {
    // Motor encoders convert the scaled float value to int32_t.
    const float value = static_cast<float>(msg.value);
    const float scaled = msg.mode == DirectDrive::POSITION
                             ? value / 360.0f * 16384.0f
                             : value * 100.0f;
    if (!std::isfinite(scaled) ||
        static_cast<double>(scaled) < std::numeric_limits<int32_t>::min() ||
        static_cast<double>(scaled) > std::numeric_limits<int32_t>::max()) {
      RCLCPP_WARN(rclcpp::get_logger("ArmHardwareInterface"),
                  "Ignoring invalid direct-drive value");
      return;
    }
    if (msg.mode == DirectDrive::POSITION) {
      const double position = msg.value * DEGREES_TO_RADIANS;
      if (position < joint->position_min || position > joint->position_max) {
        RCLCPP_WARN(
            rclcpp::get_logger("ArmHardwareInterface"),
            "Ignoring direct position %.2f degrees outside joint '%s' limits [%.2f, %.2f] degrees",
            msg.value, joint->name.c_str(),
            joint->position_min / DEGREES_TO_RADIANS,
            joint->position_max / DEGREES_TO_RADIANS);
        return;
      }
    }
  }

  joint->direct_mode = msg.mode;
  joint->direct_value = msg.value;
}

}  // namespace dcr_arm_driver

PLUGINLIB_EXPORT_CLASS(dcr_arm_driver::ArmHardwareInterface,
                       hardware_interface::SystemInterface)
