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

  auto node = rclcpp::Node::make_shared("arm_hardware_node");

  can_pub_ = node->create_publisher<can_msgs::msg::Frame>(
      "sent_messages", rclcpp::QoS(100));

  can_sub_ = node->create_subscription<can_msgs::msg::Frame>(
      "received_messages", rclcpp::QoS(100),
      [this](const can_msgs::msg::Frame& msg) {
        this->can_frame_callback(msg);
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

  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Arm activated");
  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn ArmHardwareInterface::on_deactivate(
    const rclcpp_lifecycle::State& /*previous_state*/) {
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Deactivating...");
  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn ArmHardwareInterface::on_cleanup(
    const rclcpp_lifecycle::State& /*previous_state*/) {
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Cleaning up...");
  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn ArmHardwareInterface::on_shutdown(
    const rclcpp_lifecycle::State& /*previous_state*/) {
  RCLCPP_INFO(rclcpp::get_logger("ArmHardwareInterface"), "Shutting down...");
  return hardware_interface::CallbackReturn::SUCCESS;
}

hardware_interface::CallbackReturn ArmHardwareInterface::on_error(
    const rclcpp_lifecycle::State& /*previous_state*/) {
  RCLCPP_ERROR(rclcpp::get_logger("ArmHardwareInterface"), "Error state");
  return hardware_interface::CallbackReturn::SUCCESS;
}

std::vector<hardware_interface::StateInterface>
ArmHardwareInterface::export_state_interfaces() {
  std::vector<hardware_interface::StateInterface> state_interfaces;

  for (size_t i = 0; i < joints_.size(); ++i) {
    state_interfaces.emplace_back(hardware_interface::StateInterface(
        joints_[i].name, "position", &joints_[i].position));
    state_interfaces.emplace_back(hardware_interface::StateInterface(
        joints_[i].name, "velocity", &joints_[i].velocity));
    state_interfaces.emplace_back(hardware_interface::StateInterface(
        joints_[i].name, "effort", &joints_[i].effort));
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
    auto status_req = motor_driver_->send_status_1();
    status_req.id = joint.can_id;
    if (can_pub_) {
      can_pub_->publish(status_req);
    }
  }

  return hardware_interface::return_type::OK;
}

hardware_interface::return_type ArmHardwareInterface::write(
    const rclcpp::Time& /*time*/, const rclcpp::Duration& /*period*/) {
  for (auto& joint : joints_) {
    auto cmd_msg = motor_driver_->position_control(joint.can_id,
                                                    joint.position_command);
    if (can_pub_) {
      can_pub_->publish(cmd_msg);
    }
  }

  return hardware_interface::return_type::OK;
}

void ArmHardwareInterface::can_frame_callback(
    const can_msgs::msg::Frame& msg) {
  for (auto& joint : joints_) {
    if (joint.can_id == msg.id) {
      if (msg.dlc >= 8 && msg.data[0] == 0xA4) {
        auto stat = motor_driver_->read_status_1(msg);
        joint.position = stat.angle;
        joint.velocity = stat.speed;
        joint.effort = stat.current;
      }
      break;
    }
  }
}

}  // namespace dcr_arm_driver

PLUGINLIB_EXPORT_CLASS(dcr_arm_driver::ArmHardwareInterface,
                       hardware_interface::SystemInterface)