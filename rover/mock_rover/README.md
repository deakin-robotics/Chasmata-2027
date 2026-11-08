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

For the production stack, copy `drivetrain_hardware.example.yaml` to
`drivetrain_hardware.yaml` in the drivetrain driver's `config` directory and
fill in the rover's hardware values. Then run:

```bash
docker compose up --build prod
```

Production uses the real drivetrain backend and the arm simulator. Synthetic camera feeds
run in development; the production stack does not yet start cameras.
Full trigger input requests 800 motor RPM, converted using the YAML gear ratio;
the configured motor RPM limit must be at least 800. Velocity mode uses the
wheel radius and separation from the same YAML to interpret left-stick input.
The serial device in the YAML must be a USB serial device (`ttyUSB` or `ttyACM`).
