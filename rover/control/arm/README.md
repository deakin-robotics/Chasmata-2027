# Rover arm control

ROS 2 Jazzy control stack for the rover's six degree of freedom arm. The arm uses `ros2_control` and CAN. The end effector has a separate driver. Start with the [driver operating guide](rover_ws/src/dcr_arm_driver/README.md) and [hardware commissioning guide](docs/hardware-commissioning.md).

The driver starts inhibited. Its default hardware profile disables motion. Mock tests do not establish that a gravity loaded physical arm will remain supported after CAN, motor power or torque loss. Keep physical motion disabled until the commissioning gates are satisfied.

## Architecture

```mermaid
flowchart LR
    moveit[MoveIt 2 or trajectory client]
    trajectory[arm_controller<br/>JointTrajectoryController]
    direct[/arm/direct_drive<br/>DirectDrive/]
    estop[/estop<br/>live safety heartbeat/]

    subgraph rover[Rover]
      cm[controller_manager<br/>ros2_control_node]
      hw[ArmHardwareInterface<br/>50 Hz read/write]
      bridge[nobleo_socketcan_bridge<br/>upstream package]
      motors[Six arm motors<br/>CAN IDs 0x01 to 0x06]
      telemetry[/motor_stat_1<br/>/motor_stat_2]
      states[/arm/joint_states]
      status[/arm/control/status]
      cm --> trajectory
      trajectory -->|position commands| hw
      direct -->|per-joint position or speed| hw
      estop --> hw
      hw -->|/socketcan_bridge/tx| bridge
      bridge -->|CAN| motors
      motors -->|CAN status| bridge
      bridge -->|/socketcan_bridge/rx| hw
      hw -->|position and velocity feedback| trajectory
      hw --> telemetry
      hw --> states
      hw --> status
    end
    moveit --> trajectory
    states --> moveit
```

The arm hardware plugin publishes CAN frames on `/socketcan_bridge/tx` and receives them from `/socketcan_bridge/rx`. The bridge selects and opens the physical CAN interface; the plugin's `can_interface` URDF value is descriptive and does not configure SocketCAN. The upstream `nobleo_socketcan_bridge` package has not been modified by this project.

A separate USB mock bridge can emulate the motor CAN protocol through the Arduino on `/dev/ttyUSB0`. Run either the mock transport or the physical SocketCAN bridge on the arm topics, never both at once.

## Six joint reference

Ranges and speeds below are read from `urdf/robot_arm.urdf`. The range entries are model limits, not measured safe physical limits. All six configured joints currently have a URDF velocity limit of 1 rad/s. That limit constrains software commands; it does not set or verify a motor controller's speed or current limit.

| Joint | CAN ID | Position range (rad) | Position range (degrees) | URDF velocity |
| --- | ---: | ---: | ---: | ---: |
| `base_joint` | `0x01` | -3.2288 to 3.2288 | -185 to 185 | 1.0 rad/s |
| `shoulder_joint` | `0x02` | -0.0873 to 3.2288 | -5 to 185 | 1.0 rad/s |
| `elbow_joint` | `0x03` | -0.0873 to 4.7997 | -5 to 275 | 1.0 rad/s |
| `yaw_joint` | `0x04` | -1.6581 to 3.2288 | -95 to 185 | 1.0 rad/s |
| `pitch_joint` | `0x05` | -0.0873 to 3.7525 | -5 to 215 | 1.0 rad/s |
| `roll_joint` | `0x06` | -3.2288 to 3.2288 | -185 to 185 | 1.0 rad/s |

The operator confirmed a 1:1 mechanical motor-to-joint ratio with no gearbox. Encoder zero, direction, firmware units and physical limits still need hardware confirmation. CAN ID assignments are the historical software mapping; verify the devices on the actual bus. CAN ID `0x07` is used by the separate end-effector controller.

## CAN commands and status

Standard arm commands use the selected motor's CAN ID, except fault clear (`0x00`) and the broadcast status requests (`0xFF`). `DLC` is the number of valid data bytes. Multi-byte values use little-endian byte order.

### Commands

| Command byte (`data[0]`) | CAN ID | DLC | Remaining payload | Meaning |
| --- | --- | ---: | --- | --- |
| `0xC1` | Motor ID | 5 | `data[1..4]`: signed `int32`, RPM × 100 | Speed command; current driver sends zero-speed frames for stop/inhibit |
| `0xC2` | Motor ID | 5 | `data[1..4]`: signed `int32`, degrees × 16384 / 360 | Absolute position command |
| `0xB1` | Motor ID | 1 | None | Set motor home; current driver does not call this automatically |
| `0xAF` | `0x00` | 1 | None | Clear motor faults; requires a verified hardware recovery procedure and is not sent automatically |
| `0xA4` | `0xFF` | 1 | None | Request status 1 from motors |
| `0xAE` | `0xFF` | 1 | None | Request status 2 from motors |

### Status responses

Both status replies are 8-byte frames from the responding motor's CAN ID. These fields reflect the current `Motor` parser; confirm compatibility with the exact controller firmware during commissioning.

| Reply | Byte(s) | Encoding / scale | Parsed field |
| --- | --- | --- | --- |
| `0xA4` | `data[1]` | Unsigned byte | Temperature |
| `0xA4` | `data[2..3]` | Little-endian signed `int16` × 0.001 | Motor current |
| `0xA4` | `data[4..5]` | Little-endian signed `int16` × 0.01 | Motor speed (RPM) |
| `0xA4` | `data[6..7]` | Little-endian unsigned `uint16` × 360 / 16384 | Wrapped encoder angle (degrees) |
| `0xAE` | `data[1..2]` | Little-endian unsigned `uint16` × 0.01 | Bus voltage |
| `0xAE` | `data[3..4]` | Little-endian unsigned `uint16` × 0.01 | Bus current |
| `0xAE` | `data[6]` | `0` disabled; `1` voltage; `2` current; `3` speed; `4` position | Controller mode |
| `0xAE` | `data[7]` | Bit flags: 0 voltage, 1 current, 2 temperature, 3 encoder, 6 hardware, 7 software | Faults |

The A4/Ae response layout and units are implemented in [`motor.cpp`](rover_ws/src/dcr_arm_driver/src/motor.cpp). Bytes not listed above are unused by this parser.

## Interfaces and safety behavior

| Interface | Type | Purpose |
| --- | --- | --- |
| `/arm/direct_drive` | `dcr_arm_driver/msg/DirectDrive` | Per-joint direct position (degrees) or speed (RPM), refreshed at least 10 Hz |
| `/estop` | `std_msgs/msg/Bool` | Live stop state; clear heartbeat expires after 500 ms |
| `/arm/rearm` | `std_srvs/srv/Trigger` | Explicit recovery after healthy feedback, live clear E-stop and stationary arm |
| `/arm/confirm_folded_pose` | `std_srvs/srv/Trigger` | Physically confirm calibrated encoder turn after feedback loss |
| `/arm_controller/follow_joint_trajectory` | `control_msgs/action/FollowJointTrajectory` | Trajectory control in radians |
| `/arm/joint_states` | `sensor_msgs/msg/JointState` | Measured position (rad) and velocity (rad/s) |
| `/motor_stat_1`, `/motor_stat_2` | `arm_interfaces` messages | Motor encoder and controller telemetry |
| `/arm/control/status` | `telemetry_interfaces/msg/ArmControlStatus` | Driver readiness, feedback freshness and inhibit reason |
| `/socketcan_bridge/tx`, `/socketcan_bridge/rx` | `can_msgs/msg/Frame` | CAN transport to and from the bridge |

The driver latches inhibition on stale feedback/status (250 ms), reported motor fault, invalid or ambiguous encoder, overspeed, CAN error frame, asserted/unknown/stale E-stop, expired direct command, invalid controller target, and lifecycle shutdown/error. Inhibition requests zero speed and rejects motion. A stop request cannot cross a disconnected CAN bus or guarantee torque after power loss. The driver never homes automatically, resumes an old command after recovery, or clears motor faults automatically. See the commissioning guide for recovery steps and physical stop requirements.

Wrapped encoder feedback may not identify a unique joint turn when multiple revolutions fit the configured range. The driver inhibits motion when it cannot establish an unambiguous reference. After encoder feedback is lost, it discards the prior turn reference because the arm may have moved while disconnected. The folded-pose confirmation service only restores a calibrated turn reference after a physical check; it does not move or home the arm.

## Package layout

```text
rover/control/arm/
├── README.md
├── docs/
│   ├── ARM_RTM.md
│   ├── hardware-commissioning.md
│   ├── mock-hardware-verification-handover.md
│   └── evidence/
├── rover_ws/src/
│   ├── arm_interfaces/                 # Motor telemetry messages
│   ├── dcr_arm_driver/
│   │   ├── config/
│   │   │   ├── arm_control.launch.py
│   │   │   ├── arm_controllers.yaml
│   │   │   └── single_joint_bench_controllers.yaml
│   │   ├── include/dcr_arm_driver/     # Hardware interface and protocol headers
│   │   ├── msg/DirectDrive.msg
│   │   ├── src/                        # ros2_control interface and CAN protocol
│   │   ├── test/                       # Driver regression tests
│   │   ├── urdf/
│   │   │   ├── robot_arm.urdf
│   │   │   └── single_joint_bench.urdf
│   │   └── README.md                   # Detailed operating instructions
│   ├── dcr_ee_driver/                  # Separate end-effector driver
│   └── nobleo_socketcan_bridge/        # Upstream CAN bridge, kept unmodified
└── microcontroller/mock_hardware/      # Arduino protocol simulator and USB bridge
```

The single-joint profile is an example with motion disabled and provisional limits. Calibrate it for the secured motor before enabling a local bench copy. The detailed commands, Docker build, mock setup, raw CAN inspection, direct control and fault recovery procedures are in the [driver README](rover_ws/src/dcr_arm_driver/README.md).
