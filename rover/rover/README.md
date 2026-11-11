# Mock rover

`rover` is the rover-side GUI simulator. It provides the existing topics,
FMA acknowledgement behavior, arm joint simulation, trajectory action,
heartbeat, Rover ECAM aggregation, and ROSbridge launch.

Drive mode requests and validated joystick input use a drive backend. The default
backend confirms valid mode requests after the configured mock delay. C++ callers
can inject another `DriveBackend` through `make_rover_node`; its mode result
determines whether Rover Control confirms or rejects the pending request.

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
