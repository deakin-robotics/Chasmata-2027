/*
 * USB-only rover hardware simulator. Flash this onto an Arduino-compatible
 * microcontroller and connect only its USB cable. No external modules,
 * GPIO wiring, CAN controller, RS485 transceiver, or extra library is used.
 * All positions, speeds and diagnostics are simulated in memory.
 *
 * Use usb_mock_bridge.py on the ROS computer to connect BOTH existing drivers:
 *   python3 usb_mock_bridge.py --ros-args -p port:=/dev/ttyACM0
 * It relays the arm's /socketcan_bridge/tx and /rx topics over USB and creates
 * a virtual serial port for the drivetrain. Set the drivetrain serial_device
 * to the /dev/pts/... path printed by the bridge (38400, 8N1 on that port).
 * Do not run the physical socketcan bridge at the same time.
 *
 * For drivetrain-only testing, connect its driver directly to USB instead;
 * change USB_BAUD below to 38400 first. Only one process may open USB.
 * For manual arm testing at USB_BAUD, send t0011A4 followed by CR; the reply
 * is t0018A419000000000000 followed by CR (joint 1, status 1 at zero).
 * t + 3 hexadecimal ID digits + 1 DLC digit + payload hex + CR transports
 * the arm driver's existing CAN payloads, without generating physical CAN.
 * Binary Modbus RTU requests (03/06) share the same USB stream, IDs 1..4.
 * Arm IDs 1..6, commands C1/C2/B1/AF/A4/AE match motor.cpp.
 * Feedback is sent only in response to requests; no unsolicited log output.
 *
 * Arduino IDE requires a main .ino matching its folder. Keep this source
 * and the adjacent mock_hardware.ino entry file together when uploading.
 *
 * This tests software communication and simulated feedback. The drivetrain
 * driver's readFaultRaw() is currently UNSUPPORTED and its production
 * hardware activation is gated; this simulator does not bypass those gates
 * or validate the provisional real-motor register addresses/units.
 */

#include <Arduino.h>
#include <math.h>
#include <stdint.h>

const unsigned long USB_BAUD = 500000;
const unsigned long RTU_GAP_US = 1750;
const unsigned long COMMAND_TIMEOUT_MS = 500;
const uint8_t DRIVE_IDS[] = {1, 2, 3, 4};
const uint8_t ARM_IDS[] = {1, 2, 3, 4, 5, 6};
const float ARM_POSITION_RATE_RPM = 20.0f;

struct DriveState {
  uint16_t speed;
  uint16_t control;
  uint16_t init0136;
  uint16_t init0116;
  unsigned long lastCommand;
};

struct ArmState {
  float angle;  // degrees, wrapped only when encoded in feedback
  float target;
  float rpm;
  uint8_t mode;
  unsigned long lastCommand;
};

DriveState drives[4] = {};
ArmState arms[6] = {};
unsigned long lastSimulation = 0;
uint8_t rtuBuffer[8];
uint8_t rtuLength = 0;
unsigned long lastRtuByte = 0;
char armBuffer[21];  // t + 3 ID + DLC + up to 16 payload digits
uint8_t armLength = 0;
bool receivingArm = false;
bool armOverflow = false;

uint16_t modbusCrc(const uint8_t *data, uint8_t length) {
  uint16_t crc = 0xFFFF;
  for (uint8_t i = 0; i < length; ++i) {
    crc ^= data[i];
    for (uint8_t bit = 0; bit < 8; ++bit) {
      crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
    }
  }
  return crc;
}

uint16_t bigEndian16(const uint8_t *data) {
  return (uint16_t(data[0]) << 8) | data[1];
}

void sendRtu(uint8_t *data, uint8_t length) {
  uint16_t crc = modbusCrc(data, length);
  data[length++] = uint8_t(crc);
  data[length++] = uint8_t(crc >> 8);
  Serial.write(data, length);
}

void sendException(uint8_t id, uint8_t function, uint8_t code) {
  uint8_t reply[5] = {id, uint8_t(function | 0x80), code, 0, 0};
  sendRtu(reply, 3);
}

bool readRegister(const DriveState &drive, uint16_t address, uint16_t &value) {
  switch (address) {
    case 0x0056: value = drive.speed; break;
    case 0x0066: value = drive.control; break;
    // Synthetic raw speed tracks the last command, then drops on timeout.
    // No undocumented control-word bit meanings or physical units are assumed.
    case 0x005F:
      value = (millis() - drive.lastCommand <= COMMAND_TIMEOUT_MS) ? drive.speed : 0;
      break;
    case 0x0136: value = drive.init0136; break;
    case 0x0116: value = drive.init0116; break;
    case 0x0096: value = 25; break;   // Fixed raw diagnostic samples
    case 0x00B6: value = 0; break;
    case 0x00C6: value = 2400; break;
    default: return false;
  }
  return true;
}

bool writeRegister(DriveState &drive, uint16_t address, uint16_t value) {
  switch (address) {
    case 0x0056: drive.speed = value; drive.lastCommand = millis(); break;
    case 0x0066: drive.control = value; break;
    case 0x0136: drive.init0136 = value; break;
    case 0x0116: drive.init0116 = value; break;
    default: return false;
  }
  return true;
}

void handleRtu(const uint8_t *request, uint8_t length) {
  if (length < 4) return;
  const uint16_t crc = modbusCrc(request, length - 2);
  if (request[length - 2] != uint8_t(crc) ||
      request[length - 1] != uint8_t(crc >> 8)) return;
  const uint8_t id = request[0];
  const uint8_t function = request[1];
  const bool broadcast = id == 0;
  int8_t index = -1;
  for (uint8_t i = 0; i < 4; ++i) {
    if (DRIVE_IDS[i] == id) index = i;
  }
  if (!broadcast && index < 0) return;
  if (function != 0x03 && function != 0x06) {
    if (!broadcast) sendException(id, function, 0x01);
    return;
  }
  if (length != 8) {
    if (!broadcast) sendException(id, function, 0x03);
    return;
  }
  const uint16_t address = bigEndian16(request + 2);
  const uint16_t argument = bigEndian16(request + 4);
  if (function == 0x06) {
    if (broadcast) {
      for (uint8_t i = 0; i < 4; ++i) writeRegister(drives[i], address, argument);
    } else if (writeRegister(drives[index], address, argument)) {
      uint8_t reply[8];
      for (uint8_t i = 0; i < 6; ++i) reply[i] = request[i];
      sendRtu(reply, 6);
    } else {
      sendException(id, function, 0x02);
    }
    return;
  }
  if (broadcast) return;
  // The driver requests one register; allow small contiguous reads too.
  if (argument == 0 || argument > 8 || uint32_t(address) + argument > 65536UL) {
    sendException(id, function, 0x03);
    return;
  }
  uint8_t reply[21] = {id, function, uint8_t(argument * 2)};
  for (uint8_t i = 0; i < argument; ++i) {
    uint16_t value;
    if (!readRegister(drives[index], address + i, value)) {
      sendException(id, function, 0x02);
      return;
    }
    reply[3 + i * 2] = uint8_t(value >> 8);
    reply[4 + i * 2] = uint8_t(value);
  }
  sendRtu(reply, 3 + argument * 2);
}

void simulateArm() {
  const unsigned long now = millis();
  const unsigned long elapsed = now - lastSimulation;
  if (!elapsed) return;
  lastSimulation = now;
  const float seconds = (elapsed > 100 ? 100 : elapsed) * 0.001f;
  for (uint8_t i = 0; i < 6; ++i) {
    ArmState &arm = arms[i];
    if (now - arm.lastCommand > COMMAND_TIMEOUT_MS) {
      arm.rpm = 0;
      arm.mode = 0;
    }
    if (arm.mode == 4) {
      const float error = arm.target - arm.angle;
      const float step = ARM_POSITION_RATE_RPM * 6.0f * seconds;
      const float movement = error > step ? step : (error < -step ? -step : error);
      arm.angle += movement;
      arm.rpm = movement / (6.0f * seconds);
    } else if (arm.mode == 3) {
      arm.angle += arm.rpm * 6.0f * seconds;
      arm.angle = fmodf(arm.angle, 360.0f);
    }
  }
}

void putLittle16(uint8_t *data, uint16_t value) {
  data[0] = uint8_t(value);
  data[1] = uint8_t(value >> 8);
}

void sendArmFrame(uint16_t id, const uint8_t *data, uint8_t length) {
  const char digits[] = "0123456789ABCDEF";
  char frame[22];
  frame[0] = 't';
  frame[1] = digits[(id >> 8) & 15];
  frame[2] = digits[(id >> 4) & 15];
  frame[3] = digits[id & 15];
  frame[4] = digits[length];
  for (uint8_t i = 0; i < length; ++i) {
    frame[5 + i * 2] = digits[data[i] >> 4];
    frame[6 + i * 2] = digits[data[i] & 15];
  }
  frame[5 + length * 2] = '\r';
  Serial.write(reinterpret_cast<const uint8_t *>(frame), 6 + length * 2);
}

void handleArm(uint8_t index, const uint8_t *data, uint8_t length) {
  ArmState &arm = arms[index];
  const uint8_t command = data[0];
  if ((command == 0xC1 || command == 0xC2) && length == 5) {
    const uint32_t bits = uint32_t(data[1]) | (uint32_t(data[2]) << 8) |
                          (uint32_t(data[3]) << 16) | (uint32_t(data[4]) << 24);
    // Decode two's complement without relying on unsigned-to-signed casts.
    const int32_t raw = (bits & 0x80000000UL) ?
        -1 - int32_t(~bits) : int32_t(bits);
    if (command == 0xC1) {
      float rpm = raw * 0.01f;
      arm.rpm = rpm > 300 ? 300 : (rpm < -300 ? -300 : rpm);
      arm.mode = 3;
    } else {
      arm.target = raw * (360.0f / 16384.0f);
      arm.mode = 4;
    }
    arm.lastCommand = millis();
  } else if (command == 0xB1 && length == 1) {
    arm.angle = arm.target = arm.rpm = 0;
    arm.mode = 0;
  } else if ((command == 0xA4 || command == 0xAE) && length == 1) {
    uint8_t reply[8] = {command, 0, 0, 0, 0, 0, 0, 0};
    if (command == 0xA4) {
      reply[1] = 25;
      putLittle16(reply + 4, uint16_t(int16_t(arm.rpm * 100.0f)));
      float wrapped = fmodf(arm.angle, 360.0f);
      if (wrapped < 0) wrapped += 360.0f;
      putLittle16(reply + 6, uint16_t(wrapped * (16384.0f / 360.0f)));
    } else {
      putLittle16(reply + 1, 2400);  // 24 V, zero current, no faults
      reply[6] = arm.mode;
    }
    sendArmFrame(ARM_IDS[index], reply, 8);
  } else if (command != 0xAF || length != 1) {
    return;
  }
}

// These small ASCII envelopes carry the exact arm payload bytes over USB.
int8_t hexNibble(char value) {
  if (value >= '0' && value <= '9') return value - '0';
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  if (value >= 'A' && value <= 'F') return value - 'A' + 10;
  return -1;
}

void handleArmLine(const char *line, uint8_t length) {
  if (length < 5 || line[0] != 't') return;
  for (uint8_t i = 1; i < length; ++i) {
    if (hexNibble(line[i]) < 0) return;
  }
  const uint16_t id = (uint16_t(hexNibble(line[1])) << 8) |
                      (uint16_t(hexNibble(line[2])) << 4) | hexNibble(line[3]);
  const uint8_t dlc = uint8_t(hexNibble(line[4]));
  if (id > 0x7FF || dlc < 1 || dlc > 8 || length != 5 + dlc * 2) return;
  uint8_t data[8] = {};
  for (uint8_t i = 0; i < dlc; ++i) {
    data[i] = (hexNibble(line[5 + i * 2]) << 4) | hexNibble(line[6 + i * 2]);
  }
  for (uint8_t i = 0; i < 6; ++i) {
    if (id == ARM_IDS[i] || id == 0xFF || (id == 0 && data[0] == 0xAF)) {
      handleArm(i, data, dlc);
    }
  }
}

void pollUsb() {
  // A partial packet is abandoned after a gap. Completed 8-byte Modbus
  // requests and CR-terminated arm frames can be sent back-to-back over USB.
  if ((rtuLength || receivingArm) && micros() - lastRtuByte >= 50000UL) {
    rtuLength = armLength = 0;
    receivingArm = armOverflow = false;
  }
  for (uint8_t work = 0; work < 64 && Serial.available(); ++work) {
    const unsigned long now = micros();
    if (rtuLength && now - lastRtuByte >= RTU_GAP_US) rtuLength = 0;
    const uint8_t value = uint8_t(Serial.read());
    lastRtuByte = micros();
    if (receivingArm) {
      if (value == '\r' || value == '\n') {
        if (!armOverflow) handleArmLine(armBuffer, armLength);
        receivingArm = armOverflow = false;
        armLength = 0;
      } else if (armLength < sizeof(armBuffer)) {
        armBuffer[armLength++] = char(value);
      } else {
        armOverflow = true;
      }
    } else if (rtuLength) {
      rtuBuffer[rtuLength++] = value;
      if (rtuLength == sizeof(rtuBuffer)) {
        handleRtu(rtuBuffer, rtuLength);
        rtuLength = 0;
      }
    } else if (value == 't') {
      receivingArm = true;
      armBuffer[0] = 't';
      armLength = 1;
    } else if (value <= 4) {
      rtuBuffer[0] = value;  // Addressed Modbus or broadcast
      rtuLength = 1;
    }
  }
}

void setup() {
  Serial.begin(USB_BAUD);
  lastSimulation = millis();
}

void loop() {
  simulateArm();
  pollUsb();
}
