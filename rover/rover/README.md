# Mock rover

`rover` is the rover-side GUI simulator. It provides the existing topics,
FMA acknowledgement behavior, arm joint simulation, trajectory action,
heartbeat, Rover ECAM aggregation, and ROSbridge launch.

Drive mode requests and validated joystick input use a drive backend. The default
backend confirms valid mode requests after the configured mock delay. C++ callers
can inject another `DriveBackend` through `make_rover_node`; its mode result
determines whether Rover Control confirms or rejects the pending request.

Arm control uses an `arm_backend` launch parameter. It defaults to `mock`, which
provides the simulated joint states and trajectory action. `arm_backend:=real`
selects the real arm backend. Copy `config/arm_manual.example.yaml` and set
six positive Manual speed limits in RPM, compatible with the commissioned arm
profile; pass its path as `arm_manual_config:=<path>`. Manual is confirmed only
after the driver accepts neutral direct commands for every configured joint.
Position requires the active real arm trajectory controller and a verified
ownership handoff. Rover Control gates `/arm_controller/follow_joint_trajectory`
and forwards accepted goals to the driver's `arm_real_controller` action.
Use the GUI's Clear Faults button to rearm; mode selection remains a separate
action. Development uses mock backends by default; production uses real ones.

For an isolated ROS-domain integration check with a simulated CAN bus and the
real trajectory controller, source the workspace and run:

```bash
ROS_DOMAIN_ID=196 python3 rover/rover/test/position_stack_sim.py
ROS_DOMAIN_ID=196 python3 rover/rover/test/position_stack_sim.py --full
```

The default test uses one simulated joint; `--full` exercises all six,
including independent wrist control during an unlocked trajectory. Both enable
motion only in a temporary simulator profile and do not connect to hardware.

Run the development stack with:

```bash
docker compose up --build
```

For the production stack, configure the drivetrain as described in its README.
In `rover/control/arm/config`, create these local, untracked files:

- `arm_hardware.yaml`: copy `arm_hardware.example.yaml` and set the actual,
  already configured SocketCAN interface.
- `arm_manual.yaml`: copy `rover/rover/config/arm_manual.example.yaml` and
  set the six commissioned RPM limits.
- `robot_arm.urdf` and `arm_controllers.yaml`: copy the arm driver's URDF and
  controller YAML, then use the arm team's commissioned values. Motion is
  disabled in the supplied URDF. Existing controller YAML copies must use
  `arm_real_controller` for both controller entries.

For a first setup, run from the repository root, then edit the copied files:

```bash
cp rover/control/arm/config/arm_hardware.example.yaml rover/control/arm/config/arm_hardware.yaml
cp rover/rover/config/arm_manual.example.yaml rover/control/arm/config/arm_manual.yaml
cp rover/control/arm/rover_ws/src/dcr_arm_driver/urdf/robot_arm.urdf rover/control/arm/config/robot_arm.urdf
cp rover/control/arm/rover_ws/src/dcr_arm_driver/config/arm_controllers.yaml rover/control/arm/config/arm_controllers.yaml
```

Connect the real E-stop authority that continuously publishes `/estop`, and
bring up the CAN interface using the verified bitrate before starting the
stack. See the arm driver README for commissioning and stop arrangements.
From `rover/rover`, run:

```bash
docker compose up --build prod
```

Production starts the real drivetrain and arm backends, the arm controller and
the SocketCAN bridge. It does not configure the CAN interface or provide the
E-stop authority. Use the GUI Clear Faults button to rearm the driver when
required, then select the desired arm mode. Synthetic camera feeds run in
development; the production stack does not yet start cameras.

For an isolated hardware test, set `DRIVE_BACKEND` or `ARM_BACKEND` to
`disabled` before starting production. Both default to `real`. A disabled
subsystem rejects its mode requests and publishes no simulated hardware data;
its driver and configuration checks are skipped. For example, in PowerShell:

```powershell
# Arm only
$env:DRIVE_BACKEND = 'disabled'
docker compose up --build prod

# Drivetrain only (use a new terminal, or clear DRIVE_BACKEND first)
$env:ARM_BACKEND = 'disabled'
docker compose up --build prod
```

Set both variables to `disabled` to run Rover Control with neither subsystem.
Remove the environment variables or set them to `real` for the whole rover;
PowerShell environment variables persist in the current terminal. The real arm
still needs its configured CAN interface and live E-stop authority. Cameras
require their separate production startup.
Full trigger input uses the configured bench RPM cap, converted using the YAML gear ratio.
Velocity mode uses the wheel radius and separation from the same YAML. Enable and
configure bench motion as described in the drivetrain driver README before testing.
The serial device in the YAML must be a USB serial device (`ttyUSB` or `ttyACM`).
