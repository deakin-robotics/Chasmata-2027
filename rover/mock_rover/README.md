# Mock rover

`mock_rover` is the rover-side GUI simulator. It provides the existing topics,
FMA acknowledgement behavior, arm joint simulation, trajectory action,
heartbeat, Rover ECAM aggregation, and ROSbridge launch.

Drive mode requests and validated joystick input use a drive backend. The default
backend confirms valid mode requests after the configured mock delay. C++ callers
can inject another `DriveBackend` through `make_mock_rover_node`; its mode result
determines whether Rover Control confirms or rejects the pending request.

Run the local stack with:

```bash
docker compose up --build
```

The synthetic camera publisher remains the existing shell/GStreamer helper.
