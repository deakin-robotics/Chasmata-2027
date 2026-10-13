#include "dcr_arm_driver/arm_hardware_interface.hpp"

#include <pluginlib/class_list_macros.hpp>
#include <rclcpp/rclcpp.hpp>

namespace dcr_arm_driver {

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
  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn ArmHardwareInterface::on_activate(
    const rclcpp_lifecycle::State& /*previous_state*/) {
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Activating...");

  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  active_ = false;

  // IMPORTANT: do NOT create a private node here. A node created inside a
  // ros2_control plugin is never added to any executor, so its subscription
  // callbacks (from /socketcan_bridge/rx and /motor_move) would never fire.
  // Instead, use the node that controller_manager already owns and spins.
  auto node = this->get_node();
  node_ = node;

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

  // Optional command input (mirrors the old motor_node "/motor_move" topic)
  move_sub_ = node->create_subscription<arm_interfaces::msg::MotorMove>(
      "/motor_move", rclcpp::QoS(100),
      [this](const arm_interfaces::msg::MotorMove& msg) {
        this->motor_move_callback(msg);
      });

  // Keep the stop state locally because write() runs in the ros2_control loop.
  estop_sub_ = node->create_subscription<std_msgs::msg::Bool>(
      "/estop", rclcpp::QoS(1), [this](const std_msgs::msg::Bool& msg) {
        estop_asserted_.store(msg.data, std::memory_order_relaxed);
        if (msg.data) {
          RCLCPP_WARN(rclcpp::get_logger("ArmHardwareInterface"),
                      "E-stop asserted; stopping arm motion");
        }
      });

  auto clear_fault_msg = motor_driver_->clr_faults();
  can_pub_->publish(clear_fault_msg);

  for (auto& joint : joints_) {
    auto home_msg = motor_driver_->set_home(joint.can_id);
    can_pub_->publish(home_msg);
    RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"),
                "Set home for joint: %s (CAN ID: 0x%02X)", joint.name.c_str(),
                joint.can_id);
  }

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
  move_sub_.reset();
  estop_sub_.reset();
  can_sub_.reset();
  stat1_pub_.reset();
  stat2_pub_.reset();
  can_pub_.reset();
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
  for (auto& joint : joints_) {
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
  const bool estop_asserted = estop_asserted_.load(std::memory_order_relaxed);
  for (auto& joint : joints_) {
    if (can_pub_) {
      // Repeated zero-speed commands clear any motor motion command already in
      // flight while the E-stop is active. Do not send trajectory positions.
      auto cmd_msg = estop_asserted
                         ? motor_driver_->speed_control(joint.can_id, 0.0f)
                         : motor_driver_->position_control(
                               joint.can_id,
                               joint.position_command * 180 / 3.14159265);
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
    joint->position = stat.angle;
    joint->velocity = stat.speed;
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

void ArmHardwareInterface::motor_move_callback(
    const arm_interfaces::msg::MotorMove& msg) {
  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  if (!active_) {
    return;
  }

  // Optional external command path (kept for parity with old motor_node).
  // mode == true -> position control (angle in degrees), else speed control.
  JointInfo* joint = find_joint(static_cast<uint32_t>(msg.id));
  if (joint == nullptr || !can_pub_) {
    return;
  }

  if (estop_asserted_.load(std::memory_order_relaxed)) {
    can_pub_->publish(motor_driver_->speed_control(joint->can_id, 0.0f));
    return;
  }

  can_msgs::msg::Frame cmd;
  if (msg.mode) {
    cmd = motor_driver_->position_control(joint->can_id,
                                          static_cast<float>(msg.angle));
  } else {
    cmd = motor_driver_->speed_control(joint->can_id,
                                       static_cast<float>(msg.angle));
  }
  can_pub_->publish(cmd);
}

}  // namespace dcr_arm_driver

PLUGINLIB_EXPORT_CLASS(dcr_arm_driver::ArmHardwareInterface,
                       hardware_interface::SystemInterface)
