# Rover drivetrain control

ROS 2 Jazzy development package for four BLD-305S wheel drives. All drives share one USB-to-RS485 adapter and Modbus RTU connection; slave IDs 1–4 must be unique. This package is **not validated for motion**: the hardware lifecycle gate remains closed until controller initialization, feedback, stop behavior, and timing are verified.

## How it works

```mermaid
flowchart LR
    subgraph Commands
        Twist[TwistStamped] --> Diff[diff_drive_controller]
        Wheels[Per-wheel speeds] --> Relay[direct_drive_relay]
        Relay --> Forward[wheel_velocity_controller]
    end

    Diff --> Select{One controller active at a time}
    Forward --> Select
    Select --> Hardware[RoverHardwareInterface]
    Hardware --> Driver[One serialized Modbus RTU driver]
    Driver --> Adapter[USB-to-RS485 adapter]
    Adapter --> Drives[Four wheel drives<br/>slave IDs 1 to 4]
    Drives -. unverified feedback .-> Adapter
    Adapter -.-> Driver
    Driver -.-> Hardware
    Hardware -.-> Controllers[Wheel state / telemetry]

    Probe[Optional read-only diagnostics] --> DriverProbe[Diagnostics node]
    DriverProbe --> Adapter
    DriverProbe --> Logs[Read-only telemetry and probe service]
```

Normal drive commands pass through `ros2_control`; the diagnostics node only reads registers. A Modbus acknowledgement confirms a reply, not that a motor moved. Wheel-side mirroring is configured separately from the shared bus.

## Build and test

From the repository root in a ROS 2 Jazzy environment:

```bash
sudo apt install libmodbus-dev pkg-config
source /opt/ros/jazzy/setup.bash
colcon build --packages-up-to rover_drivetrain_control --symlink-install
source install/setup.bash
colcon test --packages-select rover_drivetrain_control
colcon test-result --verbose
ros2 run rover_drivetrain_control check_drivetrain_plugin
```

## Read-only diagnostics

The launch defaults to probing disabled and does not open a serial port:

```bash
ros2 launch rover_drivetrain_control diagnostics.launch.py
ros2 topic echo /drivetrain_diagnostics/telemetry
```

For an explicitly enabled workshop probe, provide the confirmed adapter settings. Example framing and baud below are placeholders; all four drives must share them. Only one process may own the adapter at a time.

```bash
ros2 launch rover_drivetrain_control diagnostics.launch.py \
  enable_readonly_probe:=true serial_device:=/dev/ttyUSB0 \
  baud_rate:=9600 parity:=N data_bits:=8 stop_bits:=1 response_timeout_ms:=30
```

Probe a drive by slave ID; `bus` must be `drivetrain`:

```bash
ros2 service call /drivetrain_diagnostics/read_motor_diagnostic \
  rover_drivetrain_interfaces/srv/ReadMotorDiagnostic \
  "{bus: drivetrain, address: 1, register_selector: 1}"
```

Selectors 1, 2, and 3 return raw temperature (`0x0096`), current (`0x00B6`), and voltage (`0x00C6`) register values. They are not converted to physical units.

## ros2_control configuration

Copy [`config/drivetrain_hardware.example.yaml`](config/drivetrain_hardware.example.yaml), confirm every value, and pass the copy to the drivetrain launch:

```bash
ros2 launch rover_drivetrain_control drivetrain.launch.py \
  hardware_config:=/path/to/drivetrain_hardware.yaml
```

The config has one `serial_device` and `baud_rate`, shared serial framing, required timing values, and one unique slave ID per wheel. The example adapter path, timings, gearing, and RPM limits are placeholders. The launch runs in `/drivetrain`; twist drive and per-wheel drive share the same wheel interfaces, so only one controller can be active at a time. Per-wheel commands use `[front_left, rear_left, front_right, rear_right]` in rad/s.

The hardware interface currently refuses configuration and activation for motion. Do not remove that gate based on a successful build or a read-only Modbus reply. Before motion can be enabled, verify register meanings and scaling against the manufacturer manual and bench readings, confirm fault and stop behavior, add an independent hardware watchdog, and measure the full four-drive bus cycle and four stop acknowledgements. The example timing budgets are unmeasured; remeasure them on this single shared bus.

Wheel geometry in `config/drivetrain_controllers.yaml` and `urdf/drivetrain.urdf.xacro` is also placeholder data. Diagnostics telemetry and interfaces are read-only and intended for logging; production publisher details still need agreement with the GUI team.

See [`docs/VERIFICATION_MATRIX.md`](docs/VERIFICATION_MATRIX.md) for verification results and remaining checks.
