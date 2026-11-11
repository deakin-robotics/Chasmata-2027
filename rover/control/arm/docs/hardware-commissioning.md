# Arm fault handling and hardware commissioning

## Readiness boundary

The driver now defaults to **motion disabled**. This is a software preparation for supported bench tests, not certification that the arm is safe to operate. A gravity-loaded arm can fall if a motor loses power, CAN, torque or its controller. A host-side zero-speed request cannot cross a broken CAN link and is not a verified brake or torque-disable command. Support the arm mechanically and verify motor-side watchdog/brake behavior before enabling motion. Do not intentionally disconnect an unsupported loaded arm.

The operator confirmed that the motors directly drive the joints with a 1:1 mechanical ratio and no gearbox. No gearbox multiplier is required. The per-joint controller model, firmware, direction conventions, encoder zero, folded angles, braking behavior and current limits still require hardware confirmation. No automatic enable, disable or fault-clear motor opcode has been invented. The current protocol assumes its position and speed units are joint-side degrees and RPM. Do not enable a motor whose units differ until conversion is implemented and tested.

## New operating contract

| Condition | Driver response | Recovery |
| --- | --- | --- |
| Startup/reactivation | Zero-speed requests, latched inhibit, no automatic home or movement to zero | Fresh feedback, fresh E-stop-clear heartbeat, stable arm and explicit `/arm/rearm` |
| Missing any encoder/status for 250 ms | Inhibit all joints, clear direct commands, send zero speed | Restore communication, inspect/support arm, cancel goals, dwell and rearm |
| Encoder feedback lost | Discard turn references for the whole arm | Resolve from unambiguous feedback or physically confirm calibrated folded pose |
| Any nonzero motor fault byte / CAN error frame | Latch fault, stop requests | Diagnose/reset hardware using verified procedure; never auto-clear; rearm only after health recovers |
| Invalid 14-bit encoder payload, ambiguous/out-of-limit position | Latch inhibit | Correct feedback/calibration/reference; rearm |
| Measured speed > 1.5 × URDF velocity + 0.1 rad/s | Latch inhibit | Stabilize, investigate cause, rearm |
| E-stop asserted, unknown, or heartbeat absent for 500 ms | Latch inhibit | Clear via live authority, then explicit rearm |
| Direct position/speed command not refreshed within 250 ms | Clear direct commands and latch inhibit | Explicit rearm and new command stream |
| Nonfinite/out-of-limit controller command during enabled controller motion | Latch inhibit | Cancel/repair goal, rearm |
| Direct-control release | Latch inhibit; do not resume an old controller target | Rearm and submit new trajectory |
| Direct command during active trajectory | Reject | Cancel trajectory before selecting direct control |
| Lifecycle deactivation/error/shutdown | Stop requests and publish inactive readiness | Startup procedure again |
| Host/process failure or complete CAN/power loss | Host cannot guarantee delivery or stopping | Independent motor watchdog, brakes/support and hardware stop required |

These categories are explicit coverage, not a claim to account for every possible physical fault. Unreported overtemperature/current/voltage faults, silent encoder zero resets, mechanical failures, joint collisions and multiple competing publishers cannot be fully detected from these two CAN status payloads. The URDF has no validated collision geometry. Software command limiting does not establish the motor's actual speed/current limits.

### Heartbeats and command authority

A single rover-side safety authority must publish `/estop` continuously, including its asserted state. Use at least 10 Hz; a last received `false` is valid for only 500 ms. This ROS topic is not a safety-rated emergency-stop circuit. Avoid multiple publishers; access control/source ownership is not implemented here.

DirectDrive position and speed commands must be streamed at least 10 Hz while held. The existing message has no source timestamp or sequence field: the lease measures receipt time. Loss detection cannot distinguish a delayed upstream command arriving as new; keep upstream queues bounded and implement a stamped authority contract before remote deployment.

Only a newly accepted trajectory after rearm can release controller inhibition. The trajectory controller has path tolerance 0.15 rad, goal tolerance 0.02 rad and goal-time tolerance 1 s per the supplied profile. These are provisional commissioning values; validate them against the real mechanism. Clients can supply their own tolerances, so require approved action clients during testing.

### Folded startup and movement during CAN loss

Startup uses measured encoder positions, never a fictitious all-zero pose. Do not call a home command to make a folded arm read zero. The previous `/arm/set_home` service was removed because it reset state without a verified motor acknowledgement and could silently change the coordinate frame.

For a unique wrapped encoder position inside joint limits, the driver can establish its initial turn reference from feedback. For ranges wider than a revolution, a wrapped sample can be ambiguous. After communication loss the previous reference is discarded because the arm may have moved or collapsed.

To resolve an ambiguous folded pose, supply **calibrated** values for every joint in the URDF hardware parameters:

```xml
<!-- Example key only: replace VALUE with a measured joint angle in radians. -->
<param name="base_joint_folded_reference_rad">VALUE</param>
```

Use equivalent keys for shoulder, elbow, yaw, pitch and roll. Values must be finite and inside the calibrated joint limits. With the arm physically supported in that folded configuration, E-stop actively asserted and no active trajectory, call:

```bash
ros2 service call /arm/confirm_folded_pose std_srvs/srv/Trigger '{}'
```

All encoder and fault-status feedback must be recent, each joint must be stationary within 0.05 rad/s, and its wrapped position must match the configured reference within 0.05 rad. Confirmation only resolves the encoder turn; it does not send a home opcode, move the arm, clear a motor fault, or enable motion. A single-turn encoder cannot independently prove which physical turn it occupies: this service requires a human physical check. Never confirm it remotely after an unobserved collapse.

## Preparing a bench profile

Copy the supplied URDF and controller YAML into a reviewed bench profile. The launch now accepts:

```bash
ros2 launch dcr_arm_driver arm_control.launch.py \
  urdf:=/absolute/path/bench.urdf controllers:=/absolute/path/bench_controllers.yaml
```

For a secured single-motor test, configure only that joint in the URDF's `ros2_control` block and the controller YAML. Use the verified CAN ID, encoder range and conservative velocity. Do not spoof the other five joints or relax the all-configured-joints health checks.

After documenting physical support, independent stop, watchdog and motor-side limits, explicitly set `<param name="motion_enabled">true</param>` in that bench profile. The repository default remains false. Software still sends zero-speed requests when disabled; this setting is not electrical isolation or torque disable.

Bring up the real SocketCAN adapter separately at its verified bitrate. The hardware plugin uses `/socketcan_bridge/tx` and `/rx`; its `can_interface` parameter does not configure the bridge. Do not run the USB simulator bridge and physical SocketCAN bridge on the same topics.

## Startup and recovery procedure

1. Secure/support the arm; check adapter, bus termination, independent stop and motor configuration. Keep personnel outside the possible fall envelope.
2. Start bridge and arm stack. Inspect `/arm/joint_states`, motor telemetry and `/arm/control/status`. Confirm actual folded angles and signs before commanding motion.
3. Resolve an ambiguous folded turn only through the supported physical check above. Correct controller faults using the confirmed motor procedure.
4. Publish the current E-stop state from the live safety authority. To clear, maintain `false` continuously. Cancel active or canceling trajectory goals.
5. Require at least 500 ms of healthy feedback, and a stationary arm. Call `/arm/rearm` (`std_srvs/srv/Trigger`). Check the response; a failure is not permission to move.
6. Issue a new small bounded trajectory or a continuously refreshed direct command. All position outputs are slew-limited against the last sent target using the URDF velocity and at most 40 ms per update. This limits setpoint change, not guaranteed motor speed.
7. On any fault, support and inspect the arm before recovery. Communication restoration and clearing E-stop never resume old motion. Repeat the relevant steps and rearm deliberately.

## Transport changes and remaining limits

The USB simulator bridge paces shared arm/Modbus traffic, expires locally queued packets after 100 ms, replaces superseded per-joint motion commands, and prioritizes zero-speed arm commands within its arm queue. Driver TX frames are stamped; our USB mock bridge rejects stamped commands older than 100 ms or from the future. The upstream nobleo SocketCAN package is unchanged and does not enforce this timestamp policy. Driver RX ignores stamped replies older than 250 ms. Unstamped legacy traffic remains accepted by the bridges, so use a controlled graph.

Queue expiry does not cancel a command already accepted by a motor. The mock firmware has a watchdog; its behavior is not proof that the real motors have one. The physical bridge still requires measured bus-off/reconnect and physical stop validation. Use clocks consistently on the same host; clock discontinuities can inhibit communication and require recovery.

## Regression and physical acceptance

Build `dcr_arm_driver` and `nobleo_socketcan_bridge` in Jazzy. Run the arm test target with `colcon test --packages-select dcr_arm_driver`, then `colcon test-result --verbose`. The fixture filters motion commands from status requests and exercises startup, fault latching, command/heartbeat loss, ambiguous recovery, stale replies, overspeed, bad targets and lifecycle status.

Run USB queue tests with the ROS environment sourced:

```bash
cd microcontroller/mock_hardware
python3 -m unittest test_usb_mock_bridge -v
```

Before full-arm operation, record actual response and physical stop behavior for each supported motor fault, one-joint feedback loss, ROS authority loss, driver kill, adapter unplug, CAN bus-off, motor reboot, power loss, brake failure, stuck encoder and repeated reconnects. Verify recovered positions against an independent physical reference. Do not close a requirement based only on a requested zero CAN frame. Record software commit, motor firmware, calibration, watchdog limits, fault injected, timing and operator approval in the hardware test log.

## Identified hardware and protocol reference

The operator identified these combinations on 11 November 2026:

| Motor | Driver |
| --- | --- |
| GIM8108-48 | GDZ468 |
| GIM4310-36 | GDZ34 |
| GIM4305-10 | GDZ34 |

The per-joint assignment and firmware versions have not yet been supplied. Do not infer gear ratios or joint mapping solely from these model strings.

Manufacturer reference: [SteadyWin support downloads](https://steadywin.cn/en/col.jsp?id=124), GDZXXX driver documents `3.02_20250714.zip`, containing custom CAN protocol `V3.07b0`. Inspection confirms the little-endian C1/C2 command layouts and A4/AE feedback layouts used here. Its C2 count is described per motor revolution; the operator-confirmed 1:1 direct drive means this is also one joint revolution. Verify the deployed firmware and encoder convention during commissioning. The [GDZ34 release notes](https://steadywin.cn/pd.jsp?fromColId=0&id=179) associate A4 support with firmware V3028. Older firmware must not be assumed compatible. The protocol includes a brake-output command, but its presence does not prove a brake is fitted or establish safe electrical polarity. This change sends no brake command and claims no verified hardware watchdog. Record those details during commissioning.

## Software validation on 11 November 2026

The updated packages built inside the provided Jazzy development image. The upstream `nobleo_socketcan_bridge` source was restored unchanged and rebuilt; it is not part of this product's modifications.

The driver regression suite includes fault-state cases, joint-limit retreat and the manufacturer's C1/C2 command vectors. USB queue tests cover supersession/stop priority, expiry and the shared pacing budget. The live Arduino run on `/dev/ttyUSB0` passed all ten integration assertions: startup inhibit, six-joint trajectory, streamed speed, operator timeout, E-stop, rejection of commands while latched, safety-heartbeat timeout, feedback loss, reconnect remaining latched, and an inhibited trajectory aborting with error `-4`. Maximum measured trajectory error was 0.00029125 rad.

An earlier suspension test interrupted the bridge inside a serial write and produced a write timeout; the bridge exited and the driver remained latched. The successful recovery test explicitly stopped and restarted the bridge, reopening/resetting the simulator. Automatic recovery from arbitrary suspension is not claimed. The final integration script enables motion only in a temporary simulator URDF copy; the checked-in production profile stays disabled.

Preserved evidence: [integration results](evidence/arm-hardening-2026-11-11/integration-results.json), [integration script](evidence/arm-hardening-2026-11-11/verify_arm_stack.py), and [driver test results](evidence/arm-hardening-2026-11-11/driver-tests.log). The script assumes `/source` is the repository inside the Docker image, a sourced `/tmp/verify_ws/install/setup.bash`, and a flashed Arduino at `/dev/ttyUSB0`; set `VERIFY_OUT` to a fresh output directory. It exits nonzero when an assertion fails. The mock firmware is unchanged. No physical motor/CAN commissioning was performed.
