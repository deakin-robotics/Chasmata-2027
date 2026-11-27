# Rover telemetry

Telemetry backends are selected alongside the corresponding control backend.
ARM and DRIVE publish the same topics in mock and real modes. Disabled control
backends do not publish simulated subsystem telemetry.

| Topic | Type | Source |
| --- | --- | --- |
| `/telemetry/arm/joint_states` | `sensor_msgs/msg/JointState` | Mock or real `/arm/joint_states` |
| `/telemetry/arm/status` | `telemetry_interfaces/msg/ArmControlStatus` | Simulated status or real `/arm/control/status` |
| `/telemetry/arm/motor_status` | `arm_interfaces/msg/MotorStat1` | Simulated data or real `/motor_stat_1` |
| `/telemetry/arm/motor_detail` | `arm_interfaces/msg/MotorStat2` | Motor state and structured fault bits from the selected backend |
| `/telemetry/arm/commands` | `dcr_arm_driver/msg/DirectDrive` | Simulated Manual commands or real direct-drive commands |
| `/telemetry/arm/trajectory_commands` | `sensor_msgs/msg/JointState` | Desired positions from mock or real trajectory feedback |
| `/telemetry/drive/joint_states` | `sensor_msgs/msg/JointState` | Simulated wheels or `/drivetrain/validated_joint_states` |
| `/telemetry/drive/commands` | `sensor_msgs/msg/JointState` | Simulated commands or the active controller command stream |
| `/telemetry/drive/odometry` | `nav_msgs/msg/Odometry` | Simulated longitudinal odometry or the drivetrain controller's odometry |
| `/telemetry/drive/linear_command` | `geometry_msgs/msg/TwistStamped` | Simulated or commanded linear speed |
| `/telemetry/drive/temperature_raw` | `std_msgs/msg/Int32MultiArray` | Wheel index and raw temperature register, or `-1` on a failed read |
| `/telemetry/drive/current_raw` | `std_msgs/msg/Int32MultiArray` | Wheel index and raw current register, or `-1` on a failed read |
| `/telemetry/drive/fault_raw` | `std_msgs/msg/Int32MultiArray` | Wheel index and reported drive fault code |
| `/telemetry/recovery_snapshot` | `telemetry_interfaces/msg/RecoverySnapshot` | Fresh current data and explicit unavailable fields, once per second |

Rover Control interprets Manual and Velocity inputs using the same mapping for
real and mock drivetrains. The mock drivetrain receives wheel commands and uses
an illustrative motor model with inertia and drag. Mock DRIVE current
is derived from simulated motor torque; mock ARM current uses joint movement
and a gravity load. Model parameters are illustrative, not calibrated. Real
wheel values come from the active drivetrain's successful speed polls. POWER,
LINK, CAMERA and SYSTEM backends are scaffolding and are not started.

The recovery snapshot includes FMA and ECAM state, available ARM and DRIVE
values, per-field validity, and explicit unavailable categories. Stale samples
are omitted or marked invalid. The GUI uses it on reconnection without
overwriting newer live data. ECAM continues to use its own authority and
failover path.

The active bench driver schedules temperature and current reads on its background bus
worker while driving or stationary, when enough cycle time remains for a response timeout
and a margin. Control and stop requests take priority between transactions. The values are raw register counts; the GUI does not assume a
temperature or current conversion. No additional serial connection is opened.

Rover Control maps driver-reported ARM and DRIVE faults to the existing ECAM
catalogue via a single `rover` alert source. Faults stay active until a fresh
report clears the relevant condition. Failed position requests, E-stop assertions, and
telemetry loss also use the catalogue. The System Display shows telemetry;
faults are annunciated in ECAM.

For mock-only fault testing, publish `[wheel index, fault code]` to
`/mock/drive/fault` (wheel order FL, RL, FR, RR; indices 0–3), or `[joint CAN
ID, fault bits]` to `/mock/arm/fault` (IDs 1–6). Both use
`std_msgs/msg/Int32MultiArray`. Set the second value to zero to clear that
simulated fault. These inputs exist only in the mock telemetry backends.

DRIVE viewers publish `/telemetry/drive/demand` with a unique client ID and
refresh it every second. The Rover expires missing clients after three seconds
and publishes `/drivetrain/telemetry_live` while any viewer remains. Internal
telemetry continues to serve the snapshot and ECAM. The `/telemetry/drive/live/*`
topics relay fresh samples at no more than 10 Hz per field while requested.
Optional current and temperature polling uses a slower baseline without a viewer.
The 10 Hz ceiling is not a guarantee; control, stop and fault traffic retain
priority and the existing speed/fault polling remains independent of the page.
