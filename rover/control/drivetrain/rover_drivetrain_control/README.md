# DCR rover drivetrain control — development package

**Status:** ROS 2 Jazzy *development scaffold* plus runnable **diagnostics-only** launch. **Not motion-validated.** This package cannot be activated for driving yet. Do not bypass the lifecycle gate merely to make a PR appear runnable.

## Contents

- `rover_drivetrain_control` — BLD-305S Modbus RTU library, ROS 2 `SystemInterface`, testable C++ translation/timing/health core, read-only diagnostics node, launch, config example and unit tests.
- `rover_drivetrain_interfaces` — **read-only** telemetry messages for GUI logging, plus the read-only diagnostic probe service. Forrest confirmed the address/speed/direction/result fields are for logging, not commanding. **All motor commands go through `ros2_control`; there is no separate motor-command service.** Topic name, rate and publisher still need GUI-team sign-off.

The production architecture is **four separate wheel drives**, slave IDs **1–4 used once**, on **two physical RS485 buses**, two controllers per side. Wheel assignment is read from URDF parameters, not compiled in.

## Implementation status

| Requirement | Current delivery | What remains |
|---|---|---|
| 38,400 baud, 15 Hz | Explicit 38,400 validation in plugin; pure timing arithmetic checked | Drives provisioned with vendor tool; measured timing; actual running at 15 Hz |
| Never change stored baud | No Modbus write to `0x00F6` | Provision each controller/spare separately |
| Framework-free core | `drivetrain_core.hpp/.cpp`, standalone tests | Connect verified translated commands into production worker |
| No defaults for safety settings | Timing budget values required in production hardware config | Bench measurements needed; *do not invent* stop/bus budgets |
| Skip a failed drive for the rest of the cycle | Explicit `beginCycle()` / `endCycle()` and skip-on-first-miss | Real 15 Hz bus scheduler still missing |
| Health counted per cycle | Driver no longer counts 3 failed *exchanges* as 3 cycles; core tests cover 2-invalid/3-lost | Integrate per-cycle API into live worker |
| Actual speed feedback | Added `readActualSpeedRaw()` using provisional `0x005F` | Manual and bench verification; never use `0x0056` as actual speed |
| Lifecycle gate | `on_configure()` still returns `ERROR` after transport validation | Verified init/read-back, stop ACK, true feedback and scaling |
| Liveness | Monotonic timestamp updated before read/write work, late-tick check | Independent hardware watchdog circuit not built |
| Forrest extras | Interface package, launch, README, C++ tests | Review telemetry contract / on-hardware tests |

**Important:** A positive Modbus ACK is *not* verification that an addressed register means what we think it means. Every register needs **a manufacturer manual page citation plus bench observation**. The original code's raw speed and control semantics remain hardware-unverified under this rule, even where their tentative meanings are listed.

## Build in the Chasmata-2027 repository

Place these two packages next to each other under:

```text
Chasmata-2027/rover/control/drivetrain/
  rover_drivetrain_control/
  rover_drivetrain_interfaces/
```

From a Linux shell with ROS 2 Jazzy installed, **at the repository root**, run:

```bash
source /opt/ros/jazzy/setup.bash
sudo apt install libmodbus-dev pkg-config
colcon list | grep rover_drivetrain
colcon build --packages-up-to rover_drivetrain_control --symlink-install --event-handlers console_direct+
source install/setup.bash
ros2 pkg prefix rover_drivetrain_control
ros2 interface show rover_drivetrain_interfaces/msg/WheelTelemetry
ros2 run rover_drivetrain_control check_drivetrain_plugin
```

If `colcon list` does not discover the package, inspect workspace ignore markers and nested workspaces. CI results on another branch cannot prove these new source files compile.

For core-only logic without ROS:

```bash
g++ -std=c++17 -Wall -Wextra -Wpedantic -I rover/control/drivetrain/rover_drivetrain_control/include \
  rover/control/drivetrain/rover_drivetrain_control/src/drivetrain_core.cpp \
  rover/control/drivetrain/rover_drivetrain_control/test/test_drivetrain_core.cpp -o /tmp/dcr_core_test
/tmp/dcr_core_test
```

On the ROS machine, run `colcon test --packages-select rover_drivetrain_control --event-handlers console_direct+` followed by `colcon test-result --verbose`.

## Run standalone diagnostics WITHOUT any physical motor motion

```bash
ros2 launch rover_drivetrain_control diagnostics.launch.py
```

Default is `enable_readonly_probe:=false`: **does not open serial devices**. The node has no motor-command service; motor commands go through `ros2_control` only. It provides the read-only probe service and a read-only telemetry topic for GUI logging:

```bash
ros2 service list | grep read_motor_diagnostic
ros2 topic echo /drivetrain_diagnostics/telemetry
```

The topic publishes `DrivetrainTelemetry` at 1 Hz with `hardware_active: false`. It lists only wheels this node has actually probed, and for those reports only what happened: `commanded_valid: false`, `last_write_result: 0` (not attempted), and the real result of the last probe read. With probing disabled the `wheels` list is empty. `RESULT_ACKNOWLEDGED` means a valid Modbus reply, **not** wheel motion.

### Optional raw READ-only hardware probe

To open physical serial ports, you must explicitly configure each bus device, each baud rate and serial framing. A bus must not also be owned by a running controller_manager or another probe. Example run directly as a node (replace all sample device names with your machine's actual paths and confirm the settings first):

```bash
ros2 run rover_drivetrain_control drivetrain_diagnostics_node --ros-args \
  -p enable_readonly_probe:=true \
  -p left_serial_device:=/dev/ttyUSB0 -p right_serial_device:=/dev/ttyUSB1 \
  -p left_baud_rate:=9600 -p right_baud_rate:=9600 \
  -p parity:=N -p data_bits:=8 -p stop_bits:=1 \
  -p response_timeout_ms:=30
```

`8N1` above is an **example**; verify the real controllers' framing first. The 38,400-baud **production** target presumes all drives were individually provisioned with the vendor tool; the read-only probe allows other explicitly configured baud rates, including 9,600 on unprovisioned drives. It does not change stored settings, and the example 9,600 values are NOT confirmation of the real device settings. The default launch **does not** enable probing. To request raw temperature:

```bash
ros2 service call /drivetrain_diagnostics/read_motor_diagnostic \
  rover_drivetrain_interfaces/srv/ReadMotorDiagnostic \
  "{bus: left, address: 1, register_selector: 1}"
```

Selector 1 reads `0x0096`, selector 2 reads `0x00B6`, selector 3 reads `0x00C6`. The response is **raw register counts**, *not* temperature °C, ampere or voltage SI units. Do not connect this probe alongside a controller_manager controlling the same physical serial ports; only one application may own each bus.

## Direct drive without the GUI

`drivetrain.launch.py` starts the drivetrain's own `ros2_control` stack in the `/drivetrain` namespace: `robot_state_publisher`, `ros2_control_node` with the real `RoverHardwareInterface`, the controller spawners, and `direct_drive_relay`. Both ways of driving are command sources **into** `ros2_control`; nothing in this launch writes to a drive directly.

| Mode | Controller | Command topic | State at launch |
|---|---|---|---|
| Twist (default) | `diff_drive_controller` | `/drivetrain/diff_drive_controller/cmd_vel` (`geometry_msgs/TwistStamped`) | requested active |
| Per-wheel | `wheel_velocity_controller` (`forward_command_controller`) | `/drivetrain/direct/wheel_speeds` → `direct_drive_relay` → `/drivetrain/wheel_velocity_controller/commands` | inactive |

Both controllers claim the same four wheel velocity interfaces, so `ros2_control` lets only one of them be active at a time. Both stop the wheels when commands stop for 110 ms: `diff_drive_controller` through `cmd_vel_timeout: 0.11`, and the relay by publishing zeros (`core::directCommandFresh`, unit-tested).

### Launch

Every hardware value must be supplied (no silent defaults for safety settings), so `hardware_config` has no default. Copy `config/drivetrain_hardware.example.yaml`, replace every value with the confirmed one, then:

```bash
ros2 launch rover_drivetrain_control drivetrain.launch.py hardware_config:=/path/to/drivetrain_hardware.yaml
```

**Today the hardware refuses `on_configure()`, so nothing can move.** The controller manager stays up with `DCRDrivetrain` unconfigured (`shutdown_on_initial_state_failure: false`). The `joint_state_broadcaster` and `diff_drive_controller` spawners exit with an error, and the launch logs why. Check the state with:

```bash
ros2 control list_hardware_components -c /drivetrain/controller_manager
ros2 control list_controllers -c /drivetrain/controller_manager
```

`wheel_radius`/`wheel_separation` in `config/drivetrain_controllers.yaml` and the wheel placement in `urdf/drivetrain.urdf.xacro` are **placeholders**.

### Drive with teleop_twist_keyboard (default mode)

```bash
sudo apt install ros-jazzy-teleop-twist-keyboard
ros2 run teleop_twist_keyboard teleop_twist_keyboard --ros-args \
  -p stamped:=true -r cmd_vel:=/drivetrain/diff_drive_controller/cmd_vel
```

`stamped:=true` is required: on Jazzy `diff_drive_controller` only accepts `TwistStamped`. Hold a key to keep moving. With a 110 ms timeout the wheels stop between the first key press and the start of keyboard auto-repeat, so expect a short stutter when a key is first pressed. That is the timeout working, not a fault. For real fallback driving, a gamepad via `teleop_twist_joy` keeps publishing while the enable button is held and avoids the keyboard stutter (not set up in this package).

### Switch to per-wheel mode

```bash
ros2 control switch_controllers -c /drivetrain/controller_manager --strict \
  --deactivate diff_drive_controller --activate wheel_velocity_controller
```

Then publish four wheel speeds in rad/s, in the order `[front_left, rear_left, front_right, rear_right]`, at least every 110 ms:

```bash
ros2 topic pub -r 20 /drivetrain/direct/wheel_speeds std_msgs/msg/Float64MultiArray "{data: [1.0, 1.0, 1.0, 1.0]}"
```

Right-side mirroring is handled in the hardware interface, so positive values are meant to drive forward on both sides (right-side direction is still unverified). The relay rejects a message that does not have exactly four finite values, and sends zeros instead. To return to Twist mode, swap the two controller names in the `switch_controllers` command.

## Robot-description integration (not a production launch)

`config/ros2_control_example.xacro` shows an explicit parameter contract. It is a **macro/template**, not a standalone URDF or runnable controller manager. Supply the wheel names used by the team's actual CAD-generated URDF and confirm slave-to-wheel mapping with Forrest. The example enables `is_async=true`, `rw_rate=15`; verify their behavior against installed Jazzy. **Do not add a second controller manager to a running shared namespace** until the arm/drivetrain namespace decision is agreed.

Current hardware parameters include `left/right_serial_device`, `left/right_baud_rate`, `left/right_parity`, `left/right_data_bits`, `left/right_stop_bits`, optional per-bus `*_response_timeout_ms` (provisional 30 ms), and REQUIRED `update_hz`, `upstream_timeout_ms`, `stop_deadline_ms`, `measured_stop_wire_budget_ms`, `measured_worst_bus_cycle_ms`, and `late_trigger_ms`. Wheel params: `bus`, `slave_id`, `gear_ratio`, `mirrored`, and `motor_rpm_limit`.

The production wrapper **intentionally refuses** `on_configure()`, `on_activate()`, `read()` and `write()` until verified initialization, stop sequence, fault decoding and unit conversion are implemented. It is not a working drivetrain. The example uses param names provisionally and must be confirmed with the installed Jazzy interfaces.

## Safety / verification blockers (do not close by assumption)

1. **Watchdog:** No independent watchdog circuit controlling the physical EN line. A dead process cannot stop a powered drive. **No ground-contact powered tests.** For bench testing use wheels off ground, a current-limited supply, low hardware speed, a human watching the power cut, and a tested E-stop.
2. **Stop behaviour:** Coast vs brake unresolved; zero-speed then stop-word sequence is proposed but not validated. Never send arbitrary `0x0066` control bits until verified.
3. **Register verification:** Raw actual speed `0x005F`, speed scaling, right-side direction and `0x0136/0x0116` initialization are not verified under the manual-page-plus-bench criterion. Do not claim odometry accuracy or start motors.
4. **Faults:** Fault register and fault-code response are unresolved. The `readFaultRaw()` operation returns `UNSUPPORTED`. The intended stop-all behavior needs agreement with Forrest.
5. **Telemetry contract:** The telemetry messages are read-only and logging-only (confirmed by Forrest), but topic name, rate and production publisher are not yet agreed with the GUI team. The hardware plugin publishes nothing yet; only the diagnostics node publishes its probe results.
6. **Stop timing:** The upstream `/joy` converter and command arrival timeout are owned upstream; 250 ms is a team target, not a cited competition rule. An end-to-end timed stop-ACK test is mandatory.
7. **Bus timing:** Measure real bus/adapter exchanges. A late USB adapter could invalidate the 15 Hz/50% bus budget even at 38,400 baud.
8. **Namespaces:** Separate controller managers/namespaces are proposed, **not agreed** with Forrest.
9. Verify Jazzy `on_init()` signature, interface export behavior after failed init, `read/write ERROR` effect, `on_deactivate ERROR` behavior, pluginlib registration, and `is_async` schedule with *actual installed* ROS 2. A successful compile is not proof of these runtime details.

Forrest's four requests are addressed structurally; motor motion, physical watchdog and the 250 ms requirement are **not** delivered or claimed.

## Review items awaiting team decisions (not silently fixed)

- **GUI direct-command service:** resolved. Forrest confirmed the GUI fields are for logging. `MotorCommand.msg`, `MotorCommand.srv` and `MotorResult.msg` were removed, along with the always-rejecting `motor_command` service. All motor commands go through `ros2_control`.
- **Full cycle health:** `endCycle()` still assumes three required successful operations per drive. The fault register is unverified and `readFaultRaw()` returns UNSUPPORTED, so a production 15 Hz cycle cannot yet be declared fully healthy. The standalone mock uses three diagnostic reads to test per-cycle counters, which is **not** proof of production-cycle coverage. Decide verified mandatory operations before wiring the scheduler.
- **Single source of truth for cycle health:** `endCycle()` now delegates miss counting and the valid/lost decision to `core::WheelCycleHealth::finishCycle()`. The driver still decides whether a cycle was good (three successful mandatory exchanges, no failure); see the item above.
