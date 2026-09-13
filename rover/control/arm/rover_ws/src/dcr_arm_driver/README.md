# dcr_arm_driver

ROS 2 (Jazzy) **ros2_control** hardware interface for controlling the DCR
3-DOF robotic arm via CAN bus communication using
[`nobleo_socketcan_bridge`](../nobleo_socketcan_bridge).

The end effector is **not** handled here — see
[`dcr_ee_driver`](../dcr_ee_driver).

---

## Overview

```
   MoveIt2 / trajectory       ros2_control              /socketcan_bridge/tx        can0
  ┌───────────────────┐   ┌────────────────────┐   ┌────────────────────┐   ┌──────────────┐
  │ joint_trajectory  ├──►│ ArmHardwareInterface├──►│ socketcan_bridge    ├──►│ arm motors   │
  │ _controller       │   │ (SystemInterface)   │   │                     │   │ (0x01..0x03) │
  └───────────────────┘   └─────────┬──────────┘   └──────────▲─────────┘   └──────────────┘
                                     │  publishes telemetry    │  /socketcan_bridge/rx
                                     ▼  (arm_interfaces)       │
                              /motor_stat_1, /motor_stat_2, /motor_move
```

* Provides a **ros2_control `SystemInterface`** plugin
  (`dcr_arm_driver/ArmHardwareInterface`).
* **Publishes** `can_msgs/msg::Frame` on `/socketcan_bridge/tx` and
  **subscribes** to `/socketcan_bridge/rx` (the `nobleo_socketcan_bridge`
  topics).
* Exposes telemetry from `arm_interfaces` on dedicated topics
  (`/motor_stat_1`, `/motor_stat_2`) and accepts an optional command input on
  `/motor_move`.
* Runs a **50 Hz** control loop (configured in `arm_controllers.yaml`).

---

## Robot specification

### Arm kinematics

* **3 DOF revolute joints**: base, shoulder, elbow
* **End-effector link**: fixed attachment point (gripper / sensor)
* **Base link**: fixed to the rover platform

### Joint configuration

| Joint Name     | CAN ID | Type             | Range      | Effort  | Velocity  |
|----------------|--------|------------------|------------|---------|-----------|
| base_joint     | 0x01   | Revolute (Yaw)   | ±3.14 rad  | 100 N·m | 1.0 rad/s |
| shoulder_joint | 0x02   | Revolute (Pitch) | 0–3.14 rad | 100 N·m | 1.0 rad/s |
| elbow_joint    | 0x03   | Revolute (Roll)  | 0–4.71 rad | 100 N·m | 1.0 rad/s |

---

## CAN protocol

All arm commands use **CAN ID = joint CAN ID**, with the command byte in
`data[0]`.

**Motor commands**

| Command byte | Meaning           | Payload                                                |
|--------------|-------------------|--------------------------------------------------------|
| `0xC1`       | Speed control     | 4-byte little-endian signed, scaled by 100             |
| `0xC2`       | Position control  | 4-byte little-endian signed, `angle_deg × 16384 / 360` |
| `0xB1`       | Set home position | none                                                   |
| `0xAF`       | Clear faults      | none (sent to ID `0x00`)                               |

**Motor status**

| Command byte | Meaning  | Payload                                |
|--------------|----------|----------------------------------------|
| `0xA4`       | Status 1 | temperature, current, speed, angle     |
| `0xAE`       | Status 2 | bus voltage, bus current, mode, faults |

---

## Exposed interfaces

### ros2_control

| Type    | Interface                        |
|---------|----------------------------------|
| Command | `position`                       |
| State   | `position`, `velocity`, `effort` |

### Topics

| Topic                  | Message          | Direction | Description                            |
|------------------------|------------------|-----------|----------------------------------------|
| `/motor_stat_1`        | `MotorStat1`     | publish   | temperature, current, speed, angle     |
| `/motor_stat_2`        | `MotorStat2`     | publish   | bus voltage, bus current, mode, faults |
| `/motor_move`          | `MotorMove`      | subscribe | optional direct move command           |
| `/socketcan_bridge/tx` | `can_msgs/Frame` | publish   | outgoing CAN frames                    |
| `/socketcan_bridge/rx` | `can_msgs/Frame` | subscribe | incoming CAN frames                    |

---

## Message definitions

Defined in `arm_interfaces`:

```text
# MotorStat1.msg
int64   id
int64   temp
float64 current
float64 speed
float64 angle

# MotorStat2.msg
int64   id
float64 busv
float64 busc
string  mode
string  fault

# MotorMove.msg
int64   id
bool    mode      # true = position control, false = speed control
float64 angle
```

---

## Build

The interface package `arm_interfaces` must be built **first**:

```bash
cd <your_ws>              # e.g. rover/control/arm/rover_ws
colcon build --packages-select arm_interfaces dcr_arm_driver
source install/setup.bash
```

### Dependencies

* ROS 2 Jazzy: `rclcpp`, `rclcpp_lifecycle`, `hardware_interface`, `pluginlib`,
  `controller_manager`, `joint_state_broadcaster`, `joint_trajectory_controller`
* `can_msgs`, `arm_interfaces`
* `nobleo_socketcan_bridge` (runtime — provides the CAN <-> ROS bridge)

Install via `rosdep` if missing:

```bash
rosdep install --from-paths src --ignore-src -y
```

---

## Run

```bash
ros2 launch dcr_arm_driver arm_control.launch.py
```

This starts:

* `controller_manager` (`ros2_control_node`) with the URDF + `config/arm_controllers.yaml`
* `joint_state_broadcaster` spawner
* `arm_controller` (`joint_trajectory_controller`) spawner

You must also have the CAN bridge running and the CAN interface up:

```bash
# Bring up the CAN interface (500 kbps)
sudo ip link set can0 type can bitrate 500000
sudo ip link set can0 up
ip link show can0        # verify

# Monitor CAN traffic (optional)
candump can0

# Run the socketcan bridge (separate package)
ros2 run nobleo_socketcan_bridge socketcan_bridge --ros-args -p interface:=can0
```

Launch MoveIt (untested):

```bash
ros2 launch moveit_ros_move_group move_group.launch.py \
  robot_description:="$(xacro <path to the .urdf.xacro file>)"
```

---

## Parameters

Set in the URDF `<ros2_control>` block (`urdf/robot_arm.urdf`) and
`config/arm_controllers.yaml`.

| Parameter        | Type   | Default              | Description            |
|------------------|--------|----------------------|------------------------|
| `can_interface`  | string | `can0`               | SocketCAN device name  |
| `<joint>_can_id` | int    | `0x01`/`0x02`/`0x03` | CAN ID per arm joint   |
| `update_rate`    | int    | `50`                 | Control loop freq (Hz) |

Controller (`config/arm_controllers.yaml`):

| Controller                | Type                          | Interfaces                                     |
|---------------------------|-------------------------------|------------------------------------------------|
| `joint_state_broadcaster` | `joint_state_broadcaster`     | `position`, `velocity`, `effort`               |
| `arm_controller`          | `joint_trajectory_controller` | cmd: `position`; state: `position`, `velocity` |

---

## Usage examples

Inspect telemetry published by the driver:

```bash
ros2 topic echo /motor_stat_1
ros2 topic echo /motor_stat_2
```

Send an optional direct move command (bypasses MoveIt2):

```bash
# position control (mode: true), angle in degrees
ros2 topic pub --once /motor_move arm_interfaces/msg/MotorMove "{id: 1, mode: true, angle: 10.0}"

# speed control (mode: false)
ros2 topic pub --once /motor_move arm_interfaces/msg/MotorMove "{id: 1, mode: false, angle: 20.0}"
```

Watch the raw CAN frames:

```bash
candump can0
```

---

## Relationship to `dcr_ee_driver`

* `dcr_arm_driver` controls the three arm joints through **ros2_control**.
* `dcr_ee_driver` controls **only the end effector** through its **own topic**,
  bypassing ros2_control entirely.
* All end-effector code has been removed from this package and lives in
  `dcr_ee_driver` instead.

---

## Package layout

```
dcr_arm_driver/
├── CMakeLists.txt
├── package.xml
├── plugins.xml
├── README.md
├── config/
│   ├── arm_controllers.yaml
│   └── arm_control.launch.py
├── include/dcr_arm_driver/
│   ├── motor.hpp
│   └── arm_hardware_interface.hpp
├── src/
│   ├── motor.cpp
│   └── arm_hardware_interface.cpp
└── urdf/
    └── robot_arm.urdf
```
