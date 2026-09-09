# DCR Arm Driver

ROS 2 Jazzy hardware interface for controlling a 3-DOF robotic arm via CAN bus communication using `nobleo_socketcan_bridge`.

## Overview

This package provides:
- **Low-level motor driver** (`Motor` class): Direct CAN frame creation and parsing
- **ros2_control hardware interface**: Integration with ROS 2 control framework
- **MoveIt 2 compatibility**: Motion planning and trajectory execution
- **Real-time control**: 50 Hz control loop with joint state feedback

## Robot Specification

### Arm Kinematics
- **3 DOF revolute joints**: base, shoulder, elbow
- **End-effector link**: Fixed attachment point for gripper/sensor
- **Base link**: Fixed to rover platform

### Joint Configuration

| Joint Name | CAN ID | Type | Range | Effort | Velocity |
|-----------|--------|------|-------|--------|----------|
| base_joint | 0x01 | Revolute (Yaw) | ±3.14 rad | 100 N·m | 1.0 rad/s |
| shoulder_joint | 0x02 | Revolute (Pitch) | 0-3.14 rad | 100 N·m | 1.0 rad/s |
| elbow_joint | 0x03 | Revolute (Roll) | 0-4.71 rad | 100 N·m | 1.0 rad/s |

### CAN Protocol

**Motor Commands:**
- `0xC1`: Speed control (4-byte little-endian signed integer, scaled by 100)
- `0xC2`: Position control (4-byte little-endian signed integer, angle in degrees × 16384/360)
- `0xB1`: Set home position
- `0xAF`: Clear faults

**Motor Status:**
- `0xA4`: Status 1 (temperature, current, speed, angle)
- `0xAE`: Status 2 (bus voltage, bus current, mode, faults)

---

## Installation

### Prerequisites

- **ROS 2 Jazzy** installed and sourced
- **CAN interface** configured on your system (e.g., `can0`)
- **nobleo_socketcan_bridge** package
- **MoveIt 2** (optional, for motion planning)

### Install Dependencies

```bash
sudo apt-get update
sudo apt-get install ros-jazzy-hardware-interface \
                     ros-jazzy-controller-manager \
                     ros-jazzy-joint-trajectory-controller \
                     ros-jazzy-joint-state-broadcaster \
                     ros-jazzy-pluginlib \
                     ros-jazzy-socketcan-bridge
```
### Setup CAN Interface

```bash
# List available CAN interfaces
ip link show type can

# Bring up CAN interface (500 kbps)
sudo ip link set can0 type can bitrate 500000
sudo ip link set can0 up

# Verify CAN interface is up
ip link show can0

# Optional: Monitor CAN traffic
candump can0
```
if missing dependencies:
```bash
rosdep install --from-paths src --ignore-src -y
```

launch the node (for testing):
```bash
ros2 launch dcr_arm_driver arm_control.launch.py
```

launch moveit (untested):
```bash
ros2 launch moveit_ros_move_group move_group.launch.py \
  robot_description:="$(xacro <path to the .urdf.xacro file>)"
```
