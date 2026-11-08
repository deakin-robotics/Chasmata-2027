# Mock rover

`mock_rover` is the rover-side GUI simulator. It provides the existing topics,
FMA acknowledgement behavior, arm joint simulation, trajectory action,
heartbeat, Rover ECAM aggregation, and ROSbridge launch.

Drive mode requests and validated joystick input use a drive backend. The default
backend confirms valid mode requests after the configured mock delay. C++ callers
can inject another `DriveBackend` through `make_mock_rover_node`; its mode result
determines whether Rover Control confirms or rejects the pending request.

Run the development stack with:

```bash
docker compose up --build
```

For the production stack, copy `.env.drive.example` to `.env` and set the
verified `DRIVE_MAX_WHEEL_SPEED` in rad/s, the path to the verified
`DRIVE_HARDWARE_CONFIG` YAML, and `DRIVE_SERIAL_DEVICE` to the same serial
device path specified in that YAML. Then run:

```bash
docker compose up --build prod
```

Production uses the real drivetrain backend and the arm simulator. The
drivetrain hardware activation gate remains in place. Synthetic camera feeds
run in development; the production stack does not yet start cameras.
