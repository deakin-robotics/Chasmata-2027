# dcr_arm_driver

ROS 2 Jazzy arm hardware plugin for six joints via `/socketcan_bridge/tx` and `/socketcan_bridge/rx`. The SocketCAN transport is the upstream `nobleo_socketcan_bridge` package; it has not been modified. The USB mock bridge is a separate simulator transport.

**Start with [hardware commissioning](../../../docs/hardware-commissioning.md).** The default URDF disables motion. Motor/controller firmware, CAN units, folded references, physical support/brakes and motor-side loss-of-communication behavior must be verified before enabling a bench profile. A software stop cannot prevent collapse after loss of torque or CAN communication.

## Hardware reference and items on hold

The legacy rover controller addresses joints in this order, which matches the current URDF: base `0x01`, shoulder `0x02`, elbow `0x03`, yaw `0x04`, pitch `0x05`, roll `0x06`. Its end-effector commands use `0x07`. These are historical software assignments, not a measurement of the devices currently connected. The legacy launch selected `can1`, and its startup script set that interface to 1 Mbit/s. The current URDF names `can0`; verify the actual adapter name and bitrate before connecting to the physical bus. The arm plugin's `can_interface` parameter does not configure the SocketCAN bridge.

The operator confirmed **1:1 mechanical motor-to-joint conversion with no gearbox**: each motor directly drives its joint. The existing degrees/RPM conversion therefore requires no gearbox multiplier. Encoder zero, direction and controller firmware still need verification.

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

Direct modes: `CONTROLLER=0` releases direct control and latches inhibition; `POSITION=1` commands an absolute angle in degrees; `SPEED=2` commands speed in RPM. All configured joints must be healthy; a secured single-motor test requires a matching one-joint URDF and controller profile, rather than synthetic feedback for disconnected joints.

## Container and build

On the Linux host, open this repository in VS Code and select **Dev Containers: Rebuild and Reopen in Container**. The container uses ROS 2 Jazzy, host networking and privileged device access. It includes CAN tools, serial support and the arm build dependencies. Connect the CAN adapter or Arduino before starting the container. If a serial port is inaccessible, check its host ownership/group and container access; the container user belongs to `dialout`.

Alternatively, from the repository root on the host:

```bash
docker build -t chasmata-arm-test .devcontainer
docker run --rm -it --privileged --network host \
  --mount type=bind,source="$PWD",target=/source \
  --workdir /source chasmata-arm-test bash
```

Run these commands **inside the container, from the repository root**. Use the explicit source paths to avoid discovering duplicate packages in `old_code`:

```bash
source /opt/ros/jazzy/setup.bash
colcon build --base-paths \
  interfaces/telemetry_interfaces \
  rover/control/arm/rover_ws/src/arm_interfaces \
  rover/control/arm/rover_ws/src/dcr_arm_driver \
  rover/control/arm/rover_ws/src/nobleo_socketcan_bridge \
  --packages-up-to dcr_arm_driver nobleo_socketcan_bridge \
  --symlink-install
source install/setup.bash
```

In every additional container terminal, return to the repository root and source both `/opt/ros/jazzy/setup.bash` and `install/setup.bash`. All participating processes need the same `ROS_DOMAIN_ID`; use a dedicated domain for bench tests to avoid unrelated publishers. Verify it is unused before choosing a value.

## Prepare the single-joint bench

The supplied [bench URDF](urdf/single_joint_bench.urdf) and [bench controller configuration](config/single_joint_bench_controllers.yaml) configure only `base_joint`, CAN ID `0x01`. They install with the package. Motion defaults to disabled. The example position window is ±0.10 rad (±5.73 degrees) and velocity limit is 0.05 rad/s (0.477 RPM). These are provisional bench settings, not measured mechanical limits. The URDF effort value does not program the motor's current limit.

Copy the profile to a local commissioning directory:

```bash
mkdir -p /tmp/arm-bench
cp "$(ros2 pkg prefix --share dcr_arm_driver)/urdf/single_joint_bench.urdf" /tmp/arm-bench/bench.urdf
cp "$(ros2 pkg prefix --share dcr_arm_driver)/config/single_joint_bench_controllers.yaml" /tmp/arm-bench/controllers.yaml
```

Secure the motor/mechanism and provide an independent stop. Confirm its firmware, current limit and loss-of-CAN response. Inspect the measured encoder position before choosing a small permitted movement window around that position. Update **both** the joint `<limit lower/upper>` and command-interface `min/max` in the URDF. Do not home the motor to force it into the example window. Keep the test window narrower than one revolution to avoid an ambiguous turn reference.

For another joint, change its CAN ID. If renaming the joint, change every occurrence in both files, including the `<joint_name>_can_id` hardware parameter and the YAML constraint key. Configure exactly the connected joint; the driver requires fresh feedback from every configured joint. No disconnected joints need synthetic feedback.

Keep `motion_enabled` false during initial inspection. It suppresses movement commands but still sends zero-speed requests; it is not electrical isolation. After calibration and stop checks, change it to `true` **only in the local bench copy** and restart the arm launch. Preserve the calibrated profile and motor settings with the test record; `/tmp` is temporary.

### Full six-joint configuration

After single-motor commissioning, the default launch selects `urdf/robot_arm.urdf` and `config/arm_controllers.yaml`, with motion disabled:

```bash
ros2 launch dcr_arm_driver arm_control.launch.py
```

For supported full-arm motion tests, copy those two files into a persistent commissioning directory, calibrate each joint and supply their absolute paths through `urdf:=... controllers:=...`, as in the bench launch below. All six configured joints must provide healthy feedback. The driver does not plan a collision-free unfolding path; review the physical path and provide new bounded trajectories from the measured folded pose. The supplied model has no validated collision geometry.

## Start one transport

### Physical CAN motor

Identify the adapter on the Linux host:

```bash
ip -details link show type can
```

The following uses the historical `can1`/1 Mbit/s settings. Substitute the verified interface and bitrate. Bringing an interface down interrupts all devices using it, so use a dedicated bench bus:

```bash
sudo ip link set can1 down
sudo ip link set can1 type can bitrate 1000000
sudo ip link set can1 up
ip -details -statistics link show can1
```

In a sourced container terminal start the unchanged upstream bridge:

```bash
ros2 run nobleo_socketcan_bridge socketcan_bridge --ros-args -p interface:=can1
```

The plugin's `can_interface` parameter is descriptive; the bridge command selects the real interface. Start only one bridge publishing on `/socketcan_bridge/rx`. To inspect raw traffic on the host or privileged container, use `candump can1`. Confirm the expected joint responds before enabling motion.

### Arduino mock hardware

With the mock sketch already flashed and the Arduino on `/dev/ttyUSB0`, run from the repository root inside the container:

```bash
python3 microcontroller/mock_hardware/usb_mock_bridge.py --ros-args \
  -p port:=/dev/ttyUSB0 -p baud:=500000
```

Close Arduino Serial Monitor first. Run this simulator transport on its own, with the physical SocketCAN bridge stopped. The bench profile can exercise one simulated joint. For the six-joint mock use a temporary copy of `robot_arm.urdf` and the normal controller YAML. Enable motion only in that simulator copy. Mock watchdog and stop behavior do not establish the real motor's behavior.

## Launch and inspect

In another sourced terminal:

```bash
ros2 launch dcr_arm_driver arm_control.launch.py \
  urdf:=/tmp/arm-bench/bench.urdf \
  controllers:=/tmp/arm-bench/controllers.yaml
```

This starts the robot-state publisher, controller manager, joint-state broadcaster and trajectory controller. Transport and the E-stop authority run separately. Inspect:

```bash
ros2 control list_controllers
ros2 topic echo /arm/control/status
# Use separate terminals for continuous telemetry:
ros2 topic echo /arm/joint_states
ros2 topic echo /motor_stat_1
ros2 topic echo /motor_stat_2
```

Confirm the CAN ID, measured position, stationary velocity and absence of motor faults. An encoder outside the configured window causes inhibition: correct the calibration/window, not the fault checks. Status explains why motion is inhibited.

## E-stop authority and rearm

For physical testing, connect a live authority that publishes the **actual** stop state continuously on `/estop`, at least 10 Hz. Use exactly one publisher. A command-line publisher of `false` cannot sense an external stop button and must not substitute for that authority.

For an isolated mock test only, simulate the authority in its own terminal:

```bash
ros2 topic pub --rate 10 /estop std_msgs/msg/Bool '{data: false}'
```

After motion is enabled in the selected profile, feedback is healthy for at least 500 ms, the joint is stationary and no trajectory is active/canceling:

```bash
ros2 service call /arm/rearm std_srvs/srv/Trigger '{}'
```

Require `success: true`. Rearm captures the measured pose and waits for a new command; it does not move the joint by itself. A rejected rearm includes the reason. The driver starts inhibited after every restart.

## Command motion

Choose either trajectories or direct control. The examples below are for the single-joint profile and require a calibrated, unobstructed movement path. Absolute targets are in the encoder's established coordinate frame, not relative offsets.

### Small trajectory

For the default example window, **only if the measured start is near 0 rad and the path to 0.02 rad is clear**, this requests a 0.02 rad target over two seconds:

```bash
ros2 action send_goal /arm_controller/follow_joint_trajectory \
  control_msgs/action/FollowJointTrajectory \
  '{trajectory: {joint_names: [base_joint], points: [{positions: [0.02], time_from_start: {sec: 2, nanosec: 0}}]}}' \
  --feedback
```

Replace the target with a reviewed value near the measured position when using a different window. Trajectory positions use radians. For the full arm, supply all configured joint names and corresponding positions. Observe both the action result and `/arm/control/status`; successful submission alone does not prove physical completion.

### Streamed direct control

Direct control bypasses the trajectory action and selects a motor by CAN ID. Use it for a secured, closely observed bench check. First confirm that the matching profile has motion enabled, fresh healthy feedback is present, the live clear E-stop heartbeat is running, and `/arm/rearm` returned success. There must be no active trajectory. Commands must be refreshed at least 10 Hz; each new message renews a 250 ms lease.

`mode: 2` commands speed in RPM. This example streams `0.1 RPM` to CAN ID `1` (`base_joint` in the supplied bench profile):

```bash
ros2 topic pub --rate 10 /arm/direct_drive dcr_arm_driver/msg/DirectDrive \
  '{id: 1, mode: 2, value: 0.1}'
```

Here `0.1 RPM` is approximately `0.01047 rad/s`. A speed command continues moving until stopped, timed out or limited by the configured joint velocity. Monitor the bench window and stop promptly.

`mode: 1` commands an **absolute position in degrees**. It does not mean “move this many degrees from the current position.” This streams a target of one degree for CAN ID 1:

```bash
ros2 topic pub --rate 10 /arm/direct_drive dcr_arm_driver/msg/DirectDrive \\
  '{id: 1, mode: 1, value: 1.0}'
```

The driver rejects targets outside that joint's position limits. Direct position and speed both need continued streaming, even when the desired target or speed is unchanged. `mode: 0` releases direct control; release latches inhibition so an old trajectory target cannot resume.

Stop the publisher with Ctrl+C: after 250 ms without a command the driver clears direct control and latches inhibition. For an operator stop use the live E-stop authority and independent stop as appropriate. To return to trajectory control, stop the direct publisher, rearm and submit a new trajectory. Sending `mode: 0` also releases direct control and latches inhibition; rearm is still required.

### Inspect raw CAN traffic

On the host or in the privileged testing container, monitor the verified CAN interface with `candump`. The historical setup used `can1` at 1 Mbit/s; replace `can1` below if the active adapter has another name:

```bash
candump -tz can1
```

Arm requests use each motor's CAN ID (`0x01`–`0x06`) and status request bytes `A4` and `AE`. Replies should arrive from the corresponding motor IDs. Inspect raw traffic while observing `/arm/control/status` and `/motor_stat_1`, `/motor_stat_2`; use decoded driver telemetry to interpret values. Raw traffic inspection is read-only. Do not inject CAN frames with `cansend` while the driver or another controller is active, since that bypasses its limits, command lease and fault handling.

### Encoder startup ambiguity

The `A4` feedback reports a wrapped encoder angle. The driver converts each sample into a joint position within the configured URDF limits. If more than one revolution value fits those limits, a wrapped angle alone cannot identify the physical turn. Startup remains inhibited when the sample is ambiguous; it does not automatically home the motor or assume the folded pose is zero. The driver can establish an initial turn reference when the configured range and sample identify one unique position.

If feedback is lost for more than 250 ms, the driver latches inhibition and discards the previous turn reference because the arm may have moved while disconnected. Restored CAN feedback alone cannot resolve that ambiguity. After physically supporting and confirming the arm at its calibrated folded pose, configure that joint's measured `<joint_name>_folded_reference_rad` in the URDF and follow the `/arm/confirm_folded_pose` procedure above. That service requires asserted E-stop, fresh stationary feedback, no active trajectory, and agreement with the configured reference; it resolves the encoder turn only and never commands a motor home operation.

### Fault and stop behavior

The driver latches an arm wide inhibit if any configured joint has stale encoder or motor status (250 ms), a reported nonzero motor fault, an invalid/ambiguous encoder, measured overspeed, or if a CAN error frame arrives. It also latches on asserted, unknown or expired E-stop state (500 ms), expired direct command lease (250 ms), invalid controller target, direct control release, or lifecycle deactivation/error. Faults are reported in `/arm/control/status`; motor status details are published on `/motor_stat_1` and `/motor_stat_2`.

When inhibited, the host requests zero speed and prevents new motion. This request cannot reach a motor over a failed CAN link and cannot guarantee support after loss of motor power or torque. On a gravity loaded arm, mechanical support and a verified motor side watchdog or brake are required. The driver does not automatically clear motor faults. After diagnosing the cause, physically verifying the arm's position and restoring healthy feedback and the live clear E-stop heartbeat, wait until the arm is stationary and no trajectory is active, call `/arm/rearm`, require success, and submit a new command. Reconnection does not resume the previous command. The software checks the status faults visible in the A4/AE protocol; it cannot detect unreported hardware or mechanical failures.

## Stop, faults and recovery

Assert the stop through the single authority. For the mock CLI example, terminate its `false` publisher before starting an asserted heartbeat:

```bash
ros2 topic pub --rate 10 /estop std_msgs/msg/Bool '{data: true}'
```

Never leave competing clear/asserted publishers running. Missing authority for 500 ms also latches inhibition. A host stop request cannot cross a disconnected CAN bus or maintain torque through power loss; support a gravity-loaded mechanism throughout commissioning.

On a fault, stop command publishers, cancel outstanding trajectories through their action client, support the mechanism and inspect the reported reason. Fix the actual fault and verify position against a physical reference. Restore fresh feedback and the actual clear heartbeat, wait for a stationary joint and healthy dwell, then call `/arm/rearm` and issue a new command. Reconnection never resumes old motion. Motor fault clearing must follow the verified controller procedure; the driver does not clear faults automatically.

After feedback loss the driver discards turn references. For an ambiguous folded pose, configure measured `<joint_name>_folded_reference_rad` values as described in the commissioning guide. With the arm physically confirmed at that supported pose, E-stop asserted, fresh stationary feedback and no active trajectory:

```bash
ros2 service call /arm/confirm_folded_pose std_srvs/srv/Trigger '{}'
```

This only resolves the encoder turn; it does not home, enable or move the motor. The narrow single-joint bench window ordinarily gives a unique reference without this service. For shutdown, assert stop, verify physical stability, stop the arm launch, then stop the bridge and isolate motor power according to the bench procedure.

## Verification and troubleshooting

Run regression checks in the sourced container after building:

```bash
colcon test --base-paths rover/control/arm/rover_ws/src/dcr_arm_driver \
  --packages-select dcr_arm_driver
colcon test-result --verbose
(cd microcontroller/mock_hardware && python3 -m unittest test_usb_mock_bridge -v)
```

| Symptom | Check |
| --- | --- |
| Duplicate package names during build | Use the explicit `--base-paths` above; avoid scanning `old_code`. |
| No feedback | Adapter name, bitrate, termination, CAN ID, bridge process/topics and serial-port ownership. |
| Rearm says motion disabled | Enable only the commissioned local URDF copy and restart the launch using that path. |
| Rearm needs healthy feedback/E-stop | All configured joints must respond; confirm a single live authority and no motor faults. |
| Position ambiguous/out of limits | Measured encoder coordinate, configured limits and physical turn reference; do not redefine zero automatically. |
| Direct command ignored | Correct ID/mode, units, limits, successful rearm and no active trajectory. |
| Motion stops after 250 ms | Direct commands must remain streamed at 10 Hz or faster. |
| Interface errors/bus-off | Inspect `ip -details -statistics link show`; repair the bus, verify position, then explicitly rearm. |

For the first physical test, record the software commit, calibrated profile, motor/driver model and firmware, CAN ID, raw feedback, commanded/observed displacement, and actual stop behavior. Start with a secured single motor before progressing to a supported arm. Mock regression success does not close physical acceptance items.

See the [requirements matrix](../../../docs/ARM_RTM.md), [original mock verification](../../../docs/mock-hardware-verification-handover.md), and [hardware commissioning procedure](../../../docs/hardware-commissioning.md) for evidence and remaining physical acceptance tests. The end effector has its own driver and is outside this plugin's fault handling.
