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
selects the real Manual backend. Copy `config/arm_manual.example.yaml` and set
six positive Manual speed limits in RPM, compatible with the commissioned arm
profile; pass its path as `arm_manual_config:=<path>`. Manual is confirmed only
after the driver accepts neutral direct commands for every configured joint.
Position is not yet implemented. The driver must be launched and rearmed
separately for testing. Both development and production use
`mock` by default.

Run the development stack with:

```bash
docker compose up --build
```

For the production stack, copy `drivetrain_hardware.example.yaml` to
`drivetrain_hardware.yaml` in the drivetrain driver's `config` directory and
fill in the rover's hardware values. Then run:

```bash
docker compose up --build prod
```

Production uses the real drivetrain backend and the arm simulator. Synthetic camera feeds
run in development; the production stack does not yet start cameras.
Full trigger input uses the configured bench RPM cap, converted using the YAML gear ratio.
Velocity mode uses the wheel radius and separation from the same YAML. Enable and
configure bench motion as described in the drivetrain driver README before testing.
The serial device in the YAML must be a USB serial device (`ttyUSB` or `ttyACM`).
