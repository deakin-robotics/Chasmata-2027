#include "dcr_arm_driver/arm_hardware_interface.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <optional>

#include <pluginlib/class_list_macros.hpp>
#include <rclcpp/rclcpp.hpp>
#include <urdf/model.h>

namespace dcr_arm_driver {
namespace {

constexpr double TWO_PI = 6.28318530717958647692;
constexpr double PI = 3.14159265358979323846;
constexpr double DEGREES_TO_RADIANS = PI / 180.0;
constexpr double RPM_TO_RADIANS_PER_SECOND = TWO_PI / 60.0;
constexpr auto COMMAND_TIMEOUT = std::chrono::milliseconds(250);
constexpr auto ESTOP_TIMEOUT = std::chrono::milliseconds(500);
constexpr auto RECOVERY_DWELL = std::chrono::milliseconds(500);
constexpr auto FEEDBACK_TIMEOUT = std::chrono::milliseconds(250);
constexpr double DIRECT_SPEED_LIMIT_MARGIN_RADIANS = 0.02;

std::optional<double> normalize_encoder_angle(double angle_degrees,
                                              double lower_limit,
                                              double upper_limit,
                                              double reference_position,
                                              bool reference_known) {
  double wrapped_angle = std::fmod(angle_degrees * DEGREES_TO_RADIANS, TWO_PI);
  if (wrapped_angle < 0.0) {
    wrapped_angle += TWO_PI;
  }

  const auto first_turn =
      static_cast<long>(std::ceil((lower_limit - wrapped_angle) / TWO_PI));
  const auto last_turn =
      static_cast<long>(std::floor((upper_limit - wrapped_angle) / TWO_PI));
  if (first_turn > last_turn) {
    return std::nullopt;
  }
  if (!reference_known && first_turn != last_turn) {
    // A wrapped encoder value cannot identify which turn the joint occupies
    // when more than one value fits the limits. Never guess from zero at
    // startup; wait for an unambiguous reading or an established reference.
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

} // namespace

// NEW SIGNATURE - use HardwareComponentInterfaceParams [1]
hardware_interface::CallbackReturn ArmHardwareInterface::on_init(
    const hardware_interface::HardwareComponentInterfaceParams &params) {
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Initializing...");

  // Call parent on_init with new Jazzy signature [6]
  if (hardware_interface::SystemInterface::on_init(params) !=
      hardware_interface::CallbackReturn::SUCCESS) {
    return hardware_interface::CallbackReturn::ERROR;
  }

  // Extract HardwareInfo from params
  const hardware_interface::HardwareInfo &info = params.hardware_info;
  urdf::Model robot_model;
  if (!robot_model.initString(info.original_xml)) {
    RCLCPP_ERROR(rclcpp::get_logger("ArmHardwareInterface"),
                 "Unable to parse robot_description for joint limits");
    return hardware_interface::CallbackReturn::ERROR;
  }

  // Read CAN interface name from URDF <param>
  if (info.hardware_parameters.count("can_interface") == 0) {
    RCLCPP_ERROR(rclcpp::get_logger("ArmHardwareInterface"),
                 "Missing 'can_interface' parameter");
    return hardware_interface::CallbackReturn::ERROR;
  }
  can_interface_ = info.hardware_parameters.at("can_interface");
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "CAN interface: %s",
              can_interface_.c_str());

  const auto enabled = info.hardware_parameters.find("motion_enabled");
  if (enabled != info.hardware_parameters.end() && enabled->second != "true" &&
      enabled->second != "false") {
    RCLCPP_ERROR(rclcpp::get_logger("ArmHardwareInterface"),
                 "motion_enabled must be true or false");
    return hardware_interface::CallbackReturn::ERROR;
  }
  motion_enabled_ =
      enabled != info.hardware_parameters.end() && enabled->second == "true";
  if (info.joints.empty())
    return hardware_interface::CallbackReturn::ERROR;

  // Initialize joints from URDF
  joints_.clear();
  for (const auto &joint : info_.joints) {
    JointInfo joint_info;
    joint_info.name = joint.name;

    bool has_position_limits = false;
    for (const auto &command_interface : joint.command_interfaces) {
      if (command_interface.name != hardware_interface::HW_IF_POSITION) {
        continue;
      }
      try {
        joint_info.position_min = std::stod(command_interface.min);
        joint_info.position_max = std::stod(command_interface.max);
      } catch (const std::exception &e) {
        RCLCPP_ERROR(rclcpp::get_logger("ArmHardwareInterface"),
                     "Missing or invalid position limits for joint %s: %s",
                     joint.name.c_str(), e.what());
        return hardware_interface::CallbackReturn::ERROR;
      }
      has_position_limits = joint_info.position_min <= joint_info.position_max;
    }
    if (!has_position_limits) {
      const auto model_joint = robot_model.getJoint(joint.name);
      if (!model_joint || !model_joint->limits)
        return hardware_interface::CallbackReturn::ERROR;
      joint_info.position_min = model_joint->limits->lower;
      joint_info.position_max = model_joint->limits->upper;
    }

    const auto urdf_joint = robot_model.getJoint(joint.name);
    if (!urdf_joint || !urdf_joint->limits) {
      RCLCPP_ERROR(rclcpp::get_logger("ArmHardwareInterface"),
                   "Missing URDF velocity limit for joint %s",
                   joint.name.c_str());
      return hardware_interface::CallbackReturn::ERROR;
    }
    joint_info.max_velocity = urdf_joint->limits->velocity;
    if (!std::isfinite(joint_info.max_velocity) ||
        joint_info.max_velocity <= 0.0) {
      RCLCPP_ERROR(rclcpp::get_logger("ArmHardwareInterface"),
                   "max_velocity for joint %s must be finite and positive",
                   joint.name.c_str());
      return hardware_interface::CallbackReturn::ERROR;
    }

    // Read CAN ID for this joint from URDF
    std::string can_id_param = joint.name + "_can_id";
    if (info.hardware_parameters.count(can_id_param) == 0) {
      RCLCPP_ERROR(rclcpp::get_logger("ArmHardwareInterface"),
                   "Missing CAN ID parameter for joint: %s",
                   joint.name.c_str());
      return hardware_interface::CallbackReturn::ERROR;
    }

    try {
      joint_info.can_id =
          std::stoul(info.hardware_parameters.at(can_id_param), nullptr, 0);
    } catch (const std::exception &e) {
      RCLCPP_ERROR(rclcpp::get_logger("ArmHardwareInterface"),
                   "Invalid CAN ID for joint %s: %s", joint.name.c_str(),
                   e.what());
      return hardware_interface::CallbackReturn::ERROR;
    }

    if (!std::isfinite(joint_info.position_min) ||
        !std::isfinite(joint_info.position_max) ||
        joint_info.position_min >= joint_info.position_max ||
        joint_info.can_id < 1 || joint_info.can_id > 0x7FE ||
        joint_info.can_id == 0xFF ||
        std::any_of(joints_.begin(), joints_.end(),
                    [&](const JointInfo &other) {
                      return other.can_id == joint_info.can_id ||
                             other.name == joint_info.name;
                    })) {
      RCLCPP_ERROR(rclcpp::get_logger("ArmHardwareInterface"),
                   "Invalid limits or duplicate/reserved CAN ID");
      return hardware_interface::CallbackReturn::ERROR;
    }
    const auto folded =
        info.hardware_parameters.find(joint.name + "_folded_reference_rad");
    if (folded != info.hardware_parameters.end()) {
      try {
        joint_info.folded_reference = std::stod(folded->second);
      } catch (const std::exception &) {
        return hardware_interface::CallbackReturn::ERROR;
      }
      if (!std::isfinite(joint_info.folded_reference) ||
          joint_info.folded_reference < joint_info.position_min ||
          joint_info.folded_reference > joint_info.position_max)
        return hardware_interface::CallbackReturn::ERROR;
      joint_info.folded_reference_configured = true;
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
    const rclcpp_lifecycle::State & /*previous_state*/) {
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Configuring...");
  node_ = this->get_node();
  ensure_estop_subscription(node_);
  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn ArmHardwareInterface::on_activate(
    const rclcpp_lifecycle::State & /*previous_state*/) {
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Activating...");

  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  active_ = false;

  // IMPORTANT: do NOT create a private node here. A node created inside a
  // ros2_control plugin is never added to any executor, so its subscription
  // callbacks (from /socketcan_bridge/rx and /arm/direct_drive) would never
  // fire. Instead, use the node that controller_manager already owns and spins.
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
      [this](const can_msgs::msg::Frame &msg) {
        this->can_frame_callback(msg);
      });

  // Telemetry exposed from arm_interfaces (topic names match old motor_node)
  stat1_pub_ = node->create_publisher<arm_interfaces::msg::MotorStat1>(
      "/motor_stat_1", rclcpp::QoS(100));
  stat2_pub_ = node->create_publisher<arm_interfaces::msg::MotorStat2>(
      "/motor_stat_2", rclcpp::QoS(100));
  status_pub_ =
      node->create_publisher<telemetry_interfaces::msg::ArmControlStatus>(
          "/arm/control/status",
          rclcpp::QoS(rclcpp::KeepLast(1)).reliable().transient_local());

  // Direct commands are latched per joint and sent by write(), so controller
  // positions cannot overwrite them on the next control iteration.
  direct_drive_sub_ =
      node->create_subscription<dcr_arm_driver::msg::DirectDrive>(
          "/arm/direct_drive", rclcpp::QoS(1),
          [this](const dcr_arm_driver::msg::DirectDrive &msg) {
            this->direct_drive_callback(msg);
          });

  for (auto &joint : joints_) {
    joint.direct_mode = dcr_arm_driver::msg::DirectDrive::CONTROLLER;
    joint.direct_value = 0.0;
    joint.has_position_feedback = false;
    joint.has_pending_status1 = false;
    joint.has_motor_status2 = false;
    joint.motor_faulted = false;
  }
  motion_inhibited_ = true;
  fault_latched_ = true;
  fault_reason_ = "startup: explicit rearm required";
  ever_ready_ = false;
  healthy_since_ = {};
  estop_state_received_ = false;
  for (auto &joint : joints_) {
    joint.has_encoder_turn_reference = false;
    joint.folded_confirmed = false;
    joint.pending_feedback_time = {};
  }
  trajectory_rearm_ready_ = false;
  trajectory_goal_active_ = false;
  publish_status();

  // Motors retain their last speed command if this process exits abruptly.
  // Stop them before the control loop starts; do not clear a motor fault here.
  for (const auto &joint : joints_) {
    send_frame(motor_driver_->speed_control(joint.can_id, 0.0f));
  }

  rearm_service_ = node->create_service<std_srvs::srv::Trigger>(
      "/arm/rearm",
      [this](const std_srvs::srv::Trigger::Request::SharedPtr,
             std_srvs::srv::Trigger::Response::SharedPtr response) {
        std::lock_guard<std::mutex> lock(lifecycle_mutex_);
        const auto now = std::chrono::steady_clock::now();
        response->success = false;
        if (!active_ || !motion_enabled_) {
          response->message = "Motion disabled: commission hardware before "
                              "enabling motion_enabled";
        } else if (!estop_clear(now) || !all_feedback_fresh(now) ||
                   !all_motor_status_safe(now) ||
                   healthy_since_ == std::chrono::steady_clock::time_point{} ||
                   now - healthy_since_ < RECOVERY_DWELL) {
          response->message =
              "Need clear E-stop heartbeat and 500 ms of healthy feedback";
        } else if (trajectory_goal_active_ ||
                   std::any_of(joints_.begin(), joints_.end(),
                               [](const JointInfo &joint) {
                                 return std::abs(joint.velocity) > 0.05;
                               })) {
          response->message = "Cancel trajectories and mechanically stabilize "
                              "the arm before rearming";
        } else {
          fault_latched_ = false;
          fault_reason_.clear();
          motion_inhibited_ = true;
          trajectory_rearm_ready_ = true;
          for (auto &joint : joints_) {
            joint.estop_hold_position = joint.position;
            joint.last_position_command = joint.position;
            joint.direct_mode = dcr_arm_driver::msg::DirectDrive::CONTROLLER;
            joint.direct_value = 0;
          }
          response->success = true;
          response->message = "Rearmed at measured pose; send a new command";
        }
        publish_status();
      });

  folded_service_ = node->create_service<std_srvs::srv::Trigger>(
      "/arm/confirm_folded_pose",
      [this](const std_srvs::srv::Trigger::Request::SharedPtr,
             std_srvs::srv::Trigger::Response::SharedPtr response) {
        std::lock_guard<std::mutex> lock(lifecycle_mutex_);
        const auto now = std::chrono::steady_clock::now();
        response->success = false;
        response->message = "Support arm at calibrated folded pose, assert "
                            "E-stop, configure all references, cancel goals";
        if (!active_ || !fault_latched_ || !estop_state_received_ ||
            !estop_asserted_.load() || now - last_estop_ > ESTOP_TIMEOUT ||
            trajectory_goal_active_ || !all_motor_status_safe(now))
          return;
        for (const auto &joint : joints_) {
          const auto position = normalize_encoder_angle(
              joint.pending_angle_degrees, joint.position_min,
              joint.position_max, joint.folded_reference, true);
          if (!joint.folded_reference_configured ||
              joint.pending_feedback_time ==
                  std::chrono::steady_clock::time_point{} ||
              now - joint.pending_feedback_time > FEEDBACK_TIMEOUT ||
              std::abs(joint.pending_speed_rpm * RPM_TO_RADIANS_PER_SECOND) >
                  0.05 ||
              !position || std::abs(*position - joint.folded_reference) > 0.05)
            return;
        }
        for (auto &joint : joints_)
          joint.folded_confirmed = true;
        response->success = true;
        response->message = "Folded turn reference confirmed; coordinates "
                            "unchanged; clear E-stop then rearm";
      });

  trajectory_status_sub_ =
      node->create_subscription<action_msgs::msg::GoalStatusArray>(
          "/arm_controller/follow_joint_trajectory/_action/status",
          rclcpp::QoS(1).transient_local(),
          [this](const action_msgs::msg::GoalStatusArray &msg) {
            this->trajectory_status_callback(msg);
          });

  active_ = true;
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Arm activated");
  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn ArmHardwareInterface::on_deactivate(
    const rclcpp_lifecycle::State & /*previous_state*/) {
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Deactivating...");
  deactivate_endpoints();
  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn ArmHardwareInterface::on_cleanup(
    const rclcpp_lifecycle::State & /*previous_state*/) {
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Cleaning up...");
  deactivate_endpoints();
  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn ArmHardwareInterface::on_shutdown(
    const rclcpp_lifecycle::State & /*previous_state*/) {
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Shutting down...");
  deactivate_endpoints();
  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn ArmHardwareInterface::on_error(
    const rclcpp_lifecycle::State & /*previous_state*/) {
  RCLCPP_ERROR(rclcpp::get_logger("ArmHardwareInterface"), "Error state");
  deactivate_endpoints();
  return hardware_interface::CallbackReturn::SUCCESS;
}

void ArmHardwareInterface::deactivate_endpoints() {
  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  active_ = false;
  latch_fault("hardware inactive", true);
  publish_status();
  motion_inhibited_ = true;
  trajectory_rearm_ready_ = false;
  // Stop every motor before dropping the publisher. Direct speed commands are
  // latched by the motor, so stopping callbacks alone would leave it moving.
  if (can_pub_ && motor_driver_) {
    for (const auto &joint : joints_) {
      send_frame(motor_driver_->speed_control(joint.can_id, 0.0f));
    }
  }
  direct_drive_sub_.reset();
  can_sub_.reset();
  rearm_service_.reset();
  folded_service_.reset();
  trajectory_status_sub_.reset();
  stat1_pub_.reset();
  stat2_pub_.reset();
  can_pub_.reset();
}

void ArmHardwareInterface::ensure_estop_subscription(
    const rclcpp::Node::SharedPtr &node) {
  if (estop_sub_) {
    return;
  }

  // Keep this subscription alive across deactivation and cleanup so stop
  // changes are not missed while motion endpoints are torn down.
  estop_sub_ = node->create_subscription<std_msgs::msg::Bool>(
      "/estop", rclcpp::QoS(1),
      [this](const std_msgs::msg::Bool &msg) { this->estop_callback(msg); });
}

void ArmHardwareInterface::estop_callback(const std_msgs::msg::Bool &msg) {
  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  const bool previously_received = estop_state_received_;
  const bool previously_asserted =
      estop_asserted_.load(std::memory_order_relaxed);
  last_estop_ = std::chrono::steady_clock::now();
  estop_state_received_ = true;
  estop_asserted_.store(msg.data, std::memory_order_relaxed);
  if (!msg.data) {
    if (!previously_received || previously_asserted) {
      // Require a status update showing no active goal after the clear event;
      // this prevents a goal submitted during E-stop from being resumed if
      // its status callback was delayed.
      trajectory_rearm_ready_ = false;
    }
    return;
  }

  latch_fault("E-stop asserted");
  motion_inhibited_ = true;
  trajectory_rearm_ready_ = false;
  for (auto &joint : joints_) {
    joint.estop_hold_position = joint.position;
    joint.direct_mode = dcr_arm_driver::msg::DirectDrive::CONTROLLER;
    joint.direct_value = 0.0;
  }
  if (!previously_asserted)
    RCLCPP_WARN(
        rclcpp::get_logger("ArmHardwareInterface"),
        "E-stop asserted; arm motion inhibited until a new command is issued");
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

hardware_interface::return_type
ArmHardwareInterface::read(const rclcpp::Time & /*time*/,
                           const rclcpp::Duration & /*period*/) {
  std::lock_guard<std::mutex> lock(lifecycle_mutex_);

  for (auto &joint : joints_) {
    if (joint.has_position_feedback &&
        std::chrono::steady_clock::now() - joint.last_feedback_time >
            FEEDBACK_TIMEOUT) {
      latch_fault("encoder feedback timeout: " + joint.name, true);
    }
    if (joint.has_pending_status1) {
      const auto position = normalize_encoder_angle(
          joint.pending_angle_degrees, joint.position_min, joint.position_max,
          joint.folded_confirmed ? joint.folded_reference : joint.position,
          joint.folded_confirmed || joint.has_encoder_turn_reference);
      if (position &&
          std::chrono::steady_clock::now() - joint.pending_feedback_time <=
              FEEDBACK_TIMEOUT) {
        joint.folded_confirmed = false;
        joint.position = *position;
        joint.has_encoder_turn_reference = true;
        joint.last_feedback_time = joint.pending_feedback_time;
        if (!joint.has_position_feedback) {
          joint.position_command = *position;
          joint.has_position_feedback = true;
        }
        if (motion_inhibited_ &&
            joint.direct_mode == dcr_arm_driver::msg::DirectDrive::CONTROLLER &&
            !estop_asserted_.load(std::memory_order_relaxed)) {
          joint.estop_hold_position = *position;
        }
      } else {
        latch_fault("invalid or ambiguous encoder: " + joint.name);
        joint.has_position_feedback = false;
        motion_inhibited_ = true;
        trajectory_rearm_ready_ = false;
        for (auto &affected_joint : joints_) {
          affected_joint.estop_hold_position = affected_joint.position;
          affected_joint.direct_mode =
              dcr_arm_driver::msg::DirectDrive::CONTROLLER;
          affected_joint.direct_value = 0.0;
        }
        RCLCPP_WARN_THROTTLE(
            rclcpp::get_logger("ArmHardwareInterface"), *node_->get_clock(),
            5000,
            "Encoder angle %.2f degrees for joint '%s' is outside its URDF "
            "limits or ambiguous without a turn reference",
            joint.pending_angle_degrees, joint.name.c_str());
      }
      joint.velocity = joint.pending_speed_rpm * RPM_TO_RADIANS_PER_SECOND;
      if (std::abs(joint.velocity) > joint.max_velocity * 1.5 + 0.1) {
        latch_fault("measured overspeed: " + joint.name);
      }
      joint.has_pending_status1 = false;
    }
    if (!can_pub_) {
      continue;
    }
    auto status1_req = motor_driver_->send_status_1();
    status1_req.id = joint.can_id;
    send_frame(status1_req);

    auto status2_req = motor_driver_->send_status_2();
    status2_req.id = joint.can_id;
    send_frame(status2_req);
  }

  return hardware_interface::return_type::OK;
}

hardware_interface::return_type
ArmHardwareInterface::write(const rclcpp::Time & /*time*/,
                            const rclcpp::Duration &period) {
  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  if (!active_ || !can_pub_) {
    publish_status();
    return hardware_interface::return_type::OK;
  }
  const bool estop_asserted = estop_asserted_.load(std::memory_order_relaxed);
  const auto now = std::chrono::steady_clock::now();
  const bool feedback_ok = all_feedback_fresh(now);
  const bool motors_ok = all_motor_status_safe(now);
  if (feedback_ok && motors_ok) {
    ever_ready_ = true;
    if (healthy_since_ == std::chrono::steady_clock::time_point{})
      healthy_since_ = now;
  } else {
    healthy_since_ = {};
    if (ever_ready_) {
      latch_fault(feedback_ok ? "motor status stale or faulted"
                              : "encoder feedback timeout",
                  !feedback_ok);
      ever_ready_ = false;
    }
  }
  if (!estop_clear(now))
    latch_fault("E-stop asserted, unknown or heartbeat expired");
  for (const auto &joint : joints_) {
    if (joint.direct_mode != dcr_arm_driver::msg::DirectDrive::CONTROLLER &&
        now - joint.last_direct_command > COMMAND_TIMEOUT)
      latch_fault("direct command lease expired: " + joint.name);
    if (!fault_latched_ && !motion_inhibited_ &&
        (!std::isfinite(joint.position_command) ||
         joint.position_command < joint.position_min ||
         joint.position_command > joint.position_max))
      latch_fault("invalid controller target: " + joint.name);
  }
  for (auto &joint : joints_) {
    if (can_pub_) {
      const bool feedback_stale =
          !joint.has_position_feedback ||
          now - joint.last_feedback_time > FEEDBACK_TIMEOUT;
      const bool joint_motor_status_unsafe =
          !joint.has_motor_status2 || joint.motor_faulted ||
          now - joint.last_motor_status2_time > FEEDBACK_TIMEOUT;
      // Repeated zero-speed commands clear any motor motion command already in
      // flight during E-stop or feedback loss. Do not send trajectory
      // positions.
      can_msgs::msg::Frame cmd_msg;
      if (!motion_enabled_ || fault_latched_ || !feedback_ok || !motors_ok ||
          estop_asserted || !estop_clear(now) || feedback_stale ||
          joint_motor_status_unsafe) {
        cmd_msg = motor_driver_->speed_control(joint.can_id, 0.0f);
      } else if (motion_inhibited_ &&
                 joint.direct_mode ==
                     dcr_arm_driver::msg::DirectDrive::CONTROLLER) {
        const double hold_position = std::clamp(
            joint.estop_hold_position, joint.position_min, joint.position_max);
        cmd_msg = motor_driver_->position_control(
            joint.can_id,
            static_cast<float>(hold_position / DEGREES_TO_RADIANS));

      } else if (joint.direct_mode == dcr_arm_driver::msg::DirectDrive::SPEED) {
        double speed_command = joint.direct_value;
        if ((speed_command > 0.0 &&
             joint.position >=
                 joint.position_max - DIRECT_SPEED_LIMIT_MARGIN_RADIANS) ||
            (speed_command < 0.0 &&
             joint.position <=
                 joint.position_min + DIRECT_SPEED_LIMIT_MARGIN_RADIANS)) {
          speed_command = 0.0;
        }
        cmd_msg = motor_driver_->speed_control(
            joint.can_id, static_cast<float>(speed_command));
      } else if (joint.direct_mode ==
                 dcr_arm_driver::msg::DirectDrive::POSITION) {
        const double direct_position =
            std::clamp(joint.direct_value * DEGREES_TO_RADIANS,
                       joint.position_min, joint.position_max);
        cmd_msg = motor_driver_->position_control(
            joint.can_id,
            static_cast<float>(direct_position / DEGREES_TO_RADIANS));
      } else {
        const double command =
            std::isfinite(joint.position_command)
                ? std::clamp(joint.position_command, joint.position_min,
                             joint.position_max)
                : joint.position;
        cmd_msg = motor_driver_->position_control(
            joint.can_id, static_cast<float>(command / DEGREES_TO_RADIANS));
      }
      if (cmd_msg.data[0] == 0xC2) {
        const uint32_t bits = uint32_t(cmd_msg.data[1]) |
                              (uint32_t(cmd_msg.data[2]) << 8) |
                              (uint32_t(cmd_msg.data[3]) << 16) |
                              (uint32_t(cmd_msg.data[4]) << 24);
        const int32_t raw =
            bits & 0x80000000U ? -1 - int32_t(~bits) : int32_t(bits);
        const double target = raw * TWO_PI / 16384.0;
        const double step =
            joint.max_velocity * std::clamp(period.seconds(), 0.0, 0.04);
        const double bounded =
            std::clamp(target, joint.last_position_command - step,
                       joint.last_position_command + step);
        cmd_msg = motor_driver_->position_control(joint.can_id,
                                                  bounded / DEGREES_TO_RADIANS);
        joint.last_position_command = bounded;
      }
      send_frame(cmd_msg);
    }
  }

  publish_status();

  return hardware_interface::return_type::OK;
}

void ArmHardwareInterface::publish_status() {
  if (!status_pub_)
    return;
  const auto now = std::chrono::steady_clock::now();
  telemetry_interfaces::msg::ArmControlStatus status;
  status.hardware_active = active_ && static_cast<bool>(can_pub_);
  status.estop_clear = estop_clear(now);
  status.feedback_fresh = all_feedback_fresh(now);
  status.motor_status_safe = all_motor_status_safe(now);
  status.motion_inhibited =
      motion_inhibited_ || fault_latched_ || !motion_enabled_;
  status.controller_ready =
      trajectory_rearm_ready_ && !fault_latched_ && motion_enabled_;
  if (!status.hardware_active)
    status.reason = "arm hardware inactive";
  else if (!motion_enabled_)
    status.reason = "commissioning: motion disabled";
  else if (fault_latched_)
    status.reason = "latched: " + fault_reason_;
  else if (!status.estop_clear)
    status.reason = "e-stop active or unknown";
  else if (!status.feedback_fresh)
    status.reason = "joint feedback stale";
  else if (!status.motor_status_safe)
    status.reason = "motor status unsafe";
  else if (status.motion_inhibited)
    status.reason = "motion inhibited";
  else
    status.reason = "ready";
  status_pub_->publish(status);
}

JointInfo *ArmHardwareInterface::find_joint(uint32_t can_id) {
  for (auto &joint : joints_) {
    if (joint.can_id == can_id) {
      return &joint;
    }
  }
  return nullptr;
}

void ArmHardwareInterface::can_frame_callback(const can_msgs::msg::Frame &msg) {
  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  if (!active_)
    return;
  if (msg.header.stamp.sec || msg.header.stamp.nanosec) {
    const double age =
        (node_->now() - rclcpp::Time(msg.header.stamp)).seconds();
    if (age < 0 || age > 0.25)
      return; // Do not renew health from queued replies.
  }
  if (msg.is_error) {
    latch_fault("CAN error frame", true);
    return;
  }
  if (msg.is_extended || msg.is_rtr || msg.dlc != 8) {
    return;
  }

  JointInfo *joint = find_joint(msg.id);
  if (joint == nullptr) {
    return;
  }

  if (msg.data[0] == 0xA4) {
    // Status 1: temperature, current, speed, angle
    if ((uint16_t(msg.data[6]) | (uint16_t(msg.data[7]) << 8)) >= 16384) {
      latch_fault("invalid encoder payload: " + joint->name);
      return;
    }
    auto stat = motor_driver_->read_status_1(msg);
    joint->pending_feedback_time = std::chrono::steady_clock::now();
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
    const auto now = std::chrono::steady_clock::now();
    const bool was_motor_status_safe = all_motor_status_safe(now);
    auto stat = motor_driver_->read_status_2(msg);
    joint->bus_voltage = stat.busv;
    joint->bus_current = stat.busc;
    joint->mode = stat.mode;
    joint->fault = stat.fault;
    joint->has_motor_status2 = true;
    joint->motor_faulted = msg.data[7] != 0;
    joint->last_motor_status2_time = now;
    if (!all_motor_status_safe(now) || !was_motor_status_safe) {
      motion_inhibited_ = true;
      trajectory_rearm_ready_ = false;
      for (auto &affected_joint : joints_) {
        affected_joint.estop_hold_position = affected_joint.position;
        affected_joint.direct_mode =
            dcr_arm_driver::msg::DirectDrive::CONTROLLER;
        affected_joint.direct_value = 0.0;
      }
    }
    if (joint->motor_faulted)
      latch_fault("motor fault: " + joint->name);
    if (joint->motor_faulted && can_pub_) {
      send_frame(motor_driver_->speed_control(joint->can_id, 0.0f));
    }
    if (stat2_pub_) {
      stat2_pub_->publish(stat);
    }
  }
}

void ArmHardwareInterface::trajectory_status_callback(
    const action_msgs::msg::GoalStatusArray &msg) {
  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  const auto now = std::chrono::steady_clock::now();
  const bool feedback_fresh = all_feedback_fresh(now);
  const bool motor_status_safe = all_motor_status_safe(now);
  const bool active_goal = std::any_of(
      msg.status_list.begin(), msg.status_list.end(),
      [](const action_msgs::msg::GoalStatus &status) {
        return status.status == action_msgs::msg::GoalStatus::STATUS_ACCEPTED ||
               status.status ==
                   action_msgs::msg::GoalStatus::STATUS_EXECUTING ||
               status.status == action_msgs::msg::GoalStatus::STATUS_CANCELING;
      });
  if (!active_goal) {
    trajectory_rearm_ready_ = !fault_latched_ && estop_clear(now) &&
                              feedback_fresh && motor_status_safe;
  } else if (fault_latched_ || !motion_enabled_ || !estop_clear(now) ||
             !estop_state_received_ ||
             estop_asserted_.load(std::memory_order_relaxed) ||
             !feedback_fresh || !motor_status_safe) {
    // A goal that remained active through E-stop or feedback loss must finish
    // before a new goal can re-enable controller output.
    trajectory_rearm_ready_ = false;
  } else if (motion_inhibited_ && trajectory_rearm_ready_) {
    motion_inhibited_ = false;
    for (auto &joint : joints_) {
      joint.direct_mode = dcr_arm_driver::msg::DirectDrive::CONTROLLER;
      joint.direct_value = 0.0;
    }
  }
  trajectory_goal_active_ = active_goal;
}

void ArmHardwareInterface::direct_drive_callback(
    const dcr_arm_driver::msg::DirectDrive &msg) {
  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  if (!active_ || !motion_enabled_ || fault_latched_ ||
      trajectory_goal_active_ ||
      !estop_clear(std::chrono::steady_clock::now()) ||
      !estop_state_received_ ||
      estop_asserted_.load(std::memory_order_relaxed)) {
    return;
  }

  JointInfo *joint = find_joint(msg.id);
  if (joint == nullptr) {
    return;
  }

  const auto now = std::chrono::steady_clock::now();
  if (msg.mode != dcr_arm_driver::msg::DirectDrive::CONTROLLER &&
      !all_motor_status_safe(now)) {
    return;
  }
  if (msg.mode != dcr_arm_driver::msg::DirectDrive::CONTROLLER &&
      (!all_feedback_fresh(now) || !joint->has_position_feedback ||
       now - joint->last_feedback_time > FEEDBACK_TIMEOUT)) {
    RCLCPP_WARN(
        rclcpp::get_logger("ArmHardwareInterface"),
        "Ignoring direct-drive command for joint '%s' without fresh feedback",
        joint->name.c_str());
    return;
  }

  using DirectDrive = dcr_arm_driver::msg::DirectDrive;
  if (msg.mode != DirectDrive::CONTROLLER &&
      msg.mode != DirectDrive::POSITION && msg.mode != DirectDrive::SPEED) {
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
        RCLCPP_WARN(rclcpp::get_logger("ArmHardwareInterface"),
                    "Ignoring direct position %.2f degrees outside joint '%s' "
                    "limits [%.2f, %.2f] degrees",
                    msg.value, joint->name.c_str(),
                    joint->position_min / DEGREES_TO_RADIANS,
                    joint->position_max / DEGREES_TO_RADIANS);
        return;
      }
    } else if (msg.mode == DirectDrive::SPEED &&
               std::abs(static_cast<double>(msg.value)) *
                       RPM_TO_RADIANS_PER_SECOND >
                   joint->max_velocity) {
      RCLCPP_WARN(rclcpp::get_logger("ArmHardwareInterface"),
                  "Ignoring direct speed %.2f RPM above joint '%s' velocity "
                  "limit %.3f rad/s",
                  msg.value, joint->name.c_str(), joint->max_velocity);
      return;
    }
  }

  joint->last_direct_command = now;
  joint->direct_mode = msg.mode;
  joint->direct_value = msg.value;
  if (msg.mode == DirectDrive::CONTROLLER) {
    latch_fault("direct control released: rearm before new trajectory");
    joint->estop_hold_position = joint->position;
  }
}

void ArmHardwareInterface::send_frame(can_msgs::msg::Frame frame) {
  frame.header.stamp = node_->now();
  can_pub_->publish(frame);
}

bool ArmHardwareInterface::estop_clear(
    std::chrono::steady_clock::time_point now) const {
  return estop_state_received_ &&
         !estop_asserted_.load(std::memory_order_relaxed) &&
         now - last_estop_ <= ESTOP_TIMEOUT;
}

void ArmHardwareInterface::latch_fault(const std::string &reason,
                                       bool lost_reference) {
  healthy_since_ = {};
  if (!fault_latched_ || fault_reason_.find("startup") == 0)
    fault_reason_ = reason;
  fault_latched_ = true;
  motion_inhibited_ = true;
  trajectory_rearm_ready_ = false;
  for (auto &joint : joints_) {
    joint.direct_mode = dcr_arm_driver::msg::DirectDrive::CONTROLLER;
    joint.direct_value = 0;
    joint.estop_hold_position = joint.position;
    if (lost_reference) {
      joint.folded_confirmed = false;
      joint.has_encoder_turn_reference = false;
      joint.has_position_feedback = false;
    }
  }
}

bool ArmHardwareInterface::all_feedback_fresh(
    std::chrono::steady_clock::time_point now) const {
  return std::all_of(
      joints_.begin(), joints_.end(), [now](const JointInfo &joint) {
        return joint.has_position_feedback &&
               now - joint.last_feedback_time <= FEEDBACK_TIMEOUT;
      });
}

bool ArmHardwareInterface::all_motor_status_safe(
    std::chrono::steady_clock::time_point now) const {
  return std::all_of(
      joints_.begin(), joints_.end(), [now](const JointInfo &joint) {
        return joint.has_motor_status2 && !joint.motor_faulted &&
               now - joint.last_motor_status2_time <= FEEDBACK_TIMEOUT;
      });
}

} // namespace dcr_arm_driver

PLUGINLIB_EXPORT_CLASS(dcr_arm_driver::ArmHardwareInterface,
                       hardware_interface::SystemInterface)
