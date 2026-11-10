# dcr_arm_driver

ROS 2 Jazzy arm hardware plugin for six joints via `/socketcan_bridge/tx` and `/socketcan_bridge/rx`. The SocketCAN transport is the upstream `nobleo_socketcan_bridge` package; it has not been modified. The USB mock bridge is a separate simulator transport.

**Start with [hardware commissioning](../../../docs/hardware-commissioning.md).** The default URDF disables motion. Motor/controller firmware, CAN units, folded references, physical support/brakes and motor-side loss-of-communication behavior must be verified before enabling a bench profile. A software stop cannot prevent collapse after loss of torque or CAN communication.

## Hardware reference and items on hold

The legacy rover controller addresses joints in this order, which matches the current URDF: base `0x01`, shoulder `0x02`, elbow `0x03`, yaw `0x04`, pitch `0x05`, roll `0x06`. Its end-effector commands use `0x07`. These are historical software assignments, not a measurement of the devices currently connected. The legacy launch selected `can1`, and its startup script set that interface to 1 Mbit/s. The current URDF names `can0`; verify the actual adapter name and bitrate before connecting to the physical bus. The arm plugin's `can_interface` parameter does not configure the SocketCAN bridge.

The identified motor/driver combinations are GIM8108-48 + GDZ468, GIM4310-36 + GDZ34, and GIM4305-10 + GDZ34. **Physical motion testing remains on hold** until the per-joint model and CAN ID assignment, firmware and command units, encoder direction and folded readings, motor-side communication watchdog, brake or mechanical support, current limits, and independent stop are confirmed. The legacy code does not establish those facts. Record the measurements in a reviewed bench profile and follow the [commissioning procedure](../../../docs/hardware-commissioning.md) before enabling motion.

## Operating contract

- Startup uses measured joint positions. It never commands an assumed zero or automatically homes the folded arm.
- `/estop` must be continuously published by the safety authority, including `false` when clear. A clear state expires after 500 ms.
- Faults latch. Restored feedback or a new motion command cannot clear the latch.
- `/arm/rearm` requires an enabled commissioning profile, a clear live E-stop, 500 ms of healthy feedback, stationary joints and no active trajectory.
- Direct position and speed commands require refresh within 250 ms. Stream at least 10 Hz. Silence stops and latches the arm.
- Direct commands are rejected during an active trajectory. Returning direct control to `CONTROLLER` requires another rearm and new goal, so an old controller target cannot resume.
- Missing encoder or motor status, reported motor faults, invalid feedback and measured overspeed inhibit all joints. After encoder loss, previous turn references are discarded because the arm could have moved while disconnected.
- `/arm/confirm_folded_pose` resolves ambiguous encoder turns only after physical confirmation at a calibrated, supported folded pose with E-stop asserted. Configure per-joint references as described in the commissioning guide.
- `/arm/set_home` is removed. It previously reset local state without verifying a motor acknowledgement. Folded confirmation does not redefine the encoder origin.
- Position setpoints are slew-limited by the URDF velocity. This is not a replacement for hardware speed/current limits or collision avoidance.

## Interfaces

| Interface | Type | Purpose |
| --- | --- | --- |
| `/arm/direct_drive` | `dcr_arm_driver/msg/DirectDrive` | Refreshed per-joint position in degrees or speed in RPM |
| `/estop` | `std_msgs/msg/Bool` | Live stop-state heartbeat |
| `/arm/rearm` | `std_srvs/srv/Trigger` | Deliberate recovery acknowledgement |
| `/arm/confirm_folded_pose` | `std_srvs/srv/Trigger` | Confirm calibrated turn reference without motion |
| `/arm_controller/follow_joint_trajectory` | `control_msgs/action/FollowJointTrajectory` | Trajectory execution with configured tolerances |
| `/arm/joint_states` | `sensor_msgs/msg/JointState` | Position in radians, speed in rad/s |
| `/arm/control/status` | `telemetry_interfaces/msg/ArmControlStatus` | Readiness, freshness and inhibit reason |
| `/motor_stat_1`, `/motor_stat_2` | `arm_interfaces` telemetry | Per-motor encoder and controller status |

Direct modes: `CONTROLLER=0`, `POSITION=1`, `SPEED=2`. All configured joints must be healthy; a secured single-motor test requires a matching one-joint URDF and controller profile, rather than synthetic feedback for disconnected joints.

## Build and test

From the repository root in a Jazzy environment:

```bash
source /opt/ros/jazzy/setup.bash
colcon build --packages-up-to dcr_arm_driver
source install/setup.bash
colcon test --packages-select dcr_arm_driver
colcon test-result --verbose
```

Run the default profile to inspect feedback with motion disabled, or supply reviewed bench files:

```bash
ros2 launch dcr_arm_driver arm_control.launch.py \
  urdf:=/absolute/path/bench.urdf controllers:=/absolute/path/bench_controllers.yaml
```

The arm launch starts the robot-state publisher, controller manager, joint-state broadcaster and arm trajectory controller. Start/configure the actual transport separately. The end effector has its own driver and is outside this plugin's fault handling.

See the [requirements matrix](../../../docs/ARM_RTM.md), [original mock verification](../../../docs/mock-hardware-verification-handover.md), and [current commissioning procedure](../../../docs/hardware-commissioning.md) for limitations, protocol references and remaining physical acceptance tests.
