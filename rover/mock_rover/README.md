# Mock rover

`mock_rover` is the rover-side GUI simulator. It provides the existing topics,
FMA acknowledgement behavior, arm joint simulation, trajectory action,
heartbeat, Rover ECAM aggregation, and ROSbridge launch.

Run the local stack with:

```bash
docker compose up --build
```

The synthetic camera publisher remains the existing shell/GStreamer helper.
