# Mock rover

`mock_rover` is the rover-side GUI simulator. It provides the existing topics,
FMA acknowledgement behavior, arm joint simulation, trajectory action,
heartbeat, Rover ECAM aggregation, and ROSbridge launch.

Drive mode requests and validated joystick input use a drive backend. The default
backend confirms valid mode requests after the configured mock delay. C++ callers
can inject another `DriveBackend` through `make_mock_rover_node`; its mode result
determines whether Rover Control confirms or rejects the pending request.

For real drivetrain integration, set `DRIVE_MAX_WHEEL_SPEED` to the team's
verified positive wheel-speed limit in rad/s (see `.env.drive.example`) and
export it in the ROS launch environment. Start the drivetrain's existing
`drivetrain.launch.py` with its required verified `hardware_config`, then run:

```bash
set -a
source .env.drive
set +a
ros2 launch mock_rover mock_rover.launch.xml drive_backend:=real
```

Create `.env.drive` from `.env.drive.example` and fill in the verified value.

The real backend confirms Manual only when the drivetrain is active and its
wheel controller is active. The drivetrain hardware activation gate remains in
place; a running integration test is not permission to operate motors.

Run the local stack with:

```bash
docker compose up --build
```

The synthetic camera publisher remains the existing shell/GStreamer helper.
