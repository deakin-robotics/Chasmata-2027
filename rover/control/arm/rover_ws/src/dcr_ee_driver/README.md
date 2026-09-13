# dcr_ee_driver

Standalone ROS 2 (Jazzy) driver for the DCR arm **end effector**.

Unlike [`dcr_arm_driver`](../dcr_arm_driver), this package is **not** a
ros2_control hardware interface. It is a plain `rclcpp` node that listens for
commands on its **own dedicated topic** and translates them into raw CAN frames
that are sent through [`nobleo_socketcan_bridge`](../nobleo_socketcan_bridge).

---

## Overview

```
     /ee_command                 /socketcan_bridge/tx            can0
  ┌───────────────┐   EeCommand  ┌───────────────┐  Frame  ┌──────────────┐
  │   (your app)  ├─────────────►│ ee_driver_node├────────►│ socketcan_   ├──► EE controller
  └───────────────┘              └───────────────┘         │ bridge       │     (CAN ID 0x07)
                                                            └──────────────┘
```

* **Subscribes** to `arm_interfaces/msg/EeCommand` on `/ee_command`.
* **Publishes** `can_msgs/msg/Frame` on `/socketcan_bridge/tx` (the tx topic of
  `nobleo_socketcan_bridge`, node name `socketcan_bridge`, private topic `~/tx`).
* Does **not** depend on `ros2_control` / `controller_manager`.

---

## CAN protocol

All end-effector commands use **CAN ID `0x07`**, **DLC `0x02`**:

| Command byte (`data[0]`) | Meaning            | `data[1]`      |
|--------------------------|--------------------|----------------|
| `0xA0`                   | Speed control      | speed value    |
| `0xA1`                   | Position control   | position value |
| `0xA2`                   | Laser control      | `0x00`         |

This matches the legacy `motor_node` implementation (`ee_set_spd`,
`ee_set_pos`, `ee_laser`).

---

## Message definition

Defined in `arm_interfaces/msg/EeCommand.msg`:

```text
uint8 CMD_SPEED=0
uint8 CMD_POSITION=1
uint8 CMD_LASER=2

uint8 command
uint8 value
```

| `command`      | Action             | `value` used?       |
|----------------|--------------------|---------------------|
| `CMD_SPEED`    | Send speed command | yes                 |
| `CMD_POSITION` | Send position cmd  | yes                 |
| `CMD_LASER`    | Send laser command | no (forced to `0`)  |

---

## Build

Make sure `arm_interfaces` is built **first** (the driver includes
`arm_interfaces/msg/ee_command.hpp`):

```bash
cd <your_ws>              # e.g. rover/control/arm/rover_ws
colcon build --packages-select arm_interfaces dcr_ee_driver
source install/setup.bash
```

### Dependencies

* ROS 2 Jazzy (`rclcpp`)
* `can_msgs`
* `arm_interfaces`
* `nobleo_socketcan_bridge` (runtime — provides the CAN <-> ROS bridge)

---

## Run

```bash
ros2 launch dcr_ee_driver ee_driver.launch.py
```

`ee_driver.launch.py` starts `ee_driver_node` with parameters loaded from
`config/ee_params.yaml`.

You must also have the CAN bridge running and the CAN interface up:

```bash
# Bring up the CAN interface (500 kbps)
sudo ip link set can0 type can bitrate 500000
sudo ip link set can0 up

# Run the socketcan bridge (separate package)
ros2 run nobleo_socketcan_bridge socketcan_bridge --ros-args -p interface:=can0
```

---

## Parameters

Configured in `config/ee_params.yaml`:

| Parameter       | Type     | Default                  | Description                                              |
|-----------------|----------|--------------------------|----------------------------------------------------------|
| `can_tx_topic`  | string   | `/socketcan_bridge/tx`   | CAN frame output topic (bridge tx)                       |
| `command_topic` | string   | `/ee_command`            | Topic the node subscribes to for `EeCommand`             |
| `ee_can_id`     | int      | `0x07`                   | CAN ID of the end-effector controller                    |

---

## Usage examples

Send commands on the dedicated topic (no ros2_control involved):

```bash
# Position control: value = 10
ros2 topic pub --once /ee_command arm_interfaces/msg/EeCommand "{command: 1, value: 10}"

# Speed control: value = 20
ros2 topic pub --once /ee_command arm_interfaces/msg/EeCommand "{command: 0, value: 20}"

# Laser control (value ignored, forced to 0)
ros2 topic pub --once /ee_command arm_interfaces/msg/EeCommand "{command: 2, value: 0}"
```

Inspect the produced CAN frames (requires a bridge that echoes tx, or watch
`can0`):

```bash
candump can0
```

---

## Relationship to `dcr_arm_driver`

* `dcr_arm_driver` controls the three arm joints through **ros2_control**.
* `dcr_ee_driver` controls **only the end effector** through its **own topic**,
  bypassing ros2_control entirely.
* All end-effector code (`ee_set_spd`, `ee_set_pos`, `ee_laser`) has been
  removed from `dcr_arm_driver` and lives in this package instead.

---

## Package layout

```
dcr_ee_driver/
├── CMakeLists.txt
├── package.xml
├── README.md
├── config/
│   ├── ee_params.yaml
│   └── ee_driver.launch.py
└── src/
    └── ee_driver_node.cpp
```
