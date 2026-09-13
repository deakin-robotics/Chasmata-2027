#include "dcr_arm_driver/motor.hpp"

#include <cstring>
#include <sstream>

namespace dcr_arm_driver {

// Clear all faults
can_msgs::msg::Frame Motor::clr_faults() {
  can_msgs::msg::Frame msg;
  msg.id = 0x00;
  msg.dlc = 0x01;
  msg.data[0] = 0xAF;
  return msg;
}

// Set motor home position
can_msgs::msg::Frame Motor::set_home(uint32_t id) {
  can_msgs::msg::Frame msg;
  msg.id = id;
  msg.dlc = 0x01;
  msg.data[0] = 0xB1;
  return msg;
}

// Position control: convert angle (degrees) to CAN frame
can_msgs::msg::Frame Motor::position_control(uint32_t id, float angle) {
  int32_t count = static_cast<int32_t>(angle / 360.0f * 16384.0f);
  
  can_msgs::msg::Frame msg;
  msg.id = id;
  msg.dlc = 0x05;
  msg.data[0] = 0xC2;  // Position control command byte
  
  // Convert count to little-endian bytes
  msg.data[1] = static_cast<uint8_t>(count & 0xFF);
  msg.data[2] = static_cast<uint8_t>((count >> 8) & 0xFF);
  msg.data[3] = static_cast<uint8_t>((count >> 16) & 0xFF);
  msg.data[4] = static_cast<uint8_t>((count >> 24) & 0xFF);
  
  return msg;
}

// Speed control: convert speed to CAN frame
can_msgs::msg::Frame Motor::speed_control(uint32_t id, float speed_cmd) {
  int32_t speed = static_cast<int32_t>(speed_cmd * 100.0f);
  
  can_msgs::msg::Frame msg;
  msg.id = id;
  msg.dlc = 0x05;
  msg.data[0] = 0xC1;  // Speed control command byte
  
  // Convert speed to little-endian bytes
  msg.data[1] = static_cast<uint8_t>(speed & 0xFF);
  msg.data[2] = static_cast<uint8_t>((speed >> 8) & 0xFF);
  msg.data[3] = static_cast<uint8_t>((speed >> 16) & 0xFF);
  msg.data[4] = static_cast<uint8_t>((speed >> 24) & 0xFF);
  
  return msg;
}

// Request status 1 (temperature, current, speed, angle)
can_msgs::msg::Frame Motor::send_status_1() {
  can_msgs::msg::Frame msg;
  msg.id = 0xFF;
  msg.dlc = 0x01;
  msg.data[0] = 0xA4;
  return msg;
}

// Request status 2 (voltage, current, mode, faults)
can_msgs::msg::Frame Motor::send_status_2() {
  can_msgs::msg::Frame msg;
  msg.id = 0xFF;
  msg.dlc = 0x01;
  msg.data[0] = 0xAE;
  return msg;
}

// Parse status 1 response
arm_interfaces::msg::MotorStat1 Motor::read_status_1(
    const can_msgs::msg::Frame& can_stat) {
  arm_interfaces::msg::MotorStat1 stat;
  
  stat.id = static_cast<int32_t>(can_stat.id);
  stat.temp = static_cast<int32_t>(can_stat.data[1]);
  
  // Current: bytes 2-3, little-endian signed, scale by 0.001
  int16_t current_raw =
      static_cast<int16_t>(can_stat.data[2]) |
      (static_cast<int16_t>(can_stat.data[3]) << 8);
  stat.current = static_cast<float>(current_raw) * 0.001f;
  
  // Speed: bytes 4-5, little-endian signed, scale by 0.01
  int16_t speed_raw =
      static_cast<int16_t>(can_stat.data[4]) |
      (static_cast<int16_t>(can_stat.data[5]) << 8);
  stat.speed = static_cast<float>(speed_raw) * 0.01f;
  
  // Angle: bytes 6-7, little-endian unsigned, convert to degrees
  uint16_t angle_raw =
      static_cast<uint16_t>(can_stat.data[6]) |
      (static_cast<uint16_t>(can_stat.data[7]) << 8);
  stat.angle = static_cast<float>(angle_raw) * (360.0f / 16384.0f);
  
  return stat;
}

// Parse status 2 response
arm_interfaces::msg::MotorStat2 Motor::read_status_2(
    const can_msgs::msg::Frame& can_stat) {
  arm_interfaces::msg::MotorStat2 stat;
  
  stat.id = static_cast<int32_t>(can_stat.id);
  
  // Bus voltage: bytes 1-2, little-endian unsigned, scale by 0.01
  uint16_t busv_raw =
      static_cast<uint16_t>(can_stat.data[1]) |
      (static_cast<uint16_t>(can_stat.data[2]) << 8);
  stat.busv = static_cast<float>(busv_raw) * 0.01f;
  
  // Bus current: bytes 3-4, little-endian unsigned, scale by 0.01
  uint16_t busc_raw =
      static_cast<uint16_t>(can_stat.data[3]) |
      (static_cast<uint16_t>(can_stat.data[4]) << 8);
  stat.busc = static_cast<float>(busc_raw) * 0.01f;
  
  // Motor mode (byte 6)
  uint8_t mode = can_stat.data[6];
  switch (mode) {
    case 0:
      stat.mode = "Disabled";
      break;
    case 1:
      stat.mode = "Voltage Control";
      break;
    case 2:
      stat.mode = "Current Control";
      break;
    case 3:
      stat.mode = "Speed Control";
      break;
    case 4:
      stat.mode = "Position Control";
      break;
    default:
      stat.mode = "No Mode";
  }
  
  // Fault flags (byte 7)
  uint8_t fault = can_stat.data[7];
  std::stringstream fault_stream;
  fault_stream << "Faults: ";
  
  if ((fault >> 0) & 1) fault_stream << "Voltage ";
  if ((fault >> 1) & 1) fault_stream << "Current ";
  if ((fault >> 2) & 1) fault_stream << "Temperature ";
  if ((fault >> 3) & 1) fault_stream << "Encoder ";
  if ((fault >> 6) & 1) fault_stream << "Hardware ";
  if ((fault >> 7) & 1) fault_stream << "Software ";
  
  stat.fault = fault_stream.str();
  
  return stat;
}

}  // namespace dcr_arm_driver