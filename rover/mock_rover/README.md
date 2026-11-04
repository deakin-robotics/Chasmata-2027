# C++ mock rover

`mock_rover` is the C++ ROS 2 implementation of the rover-side GUI simulator.
It preserves the legacy topics, FMA acknowledgement behavior, arm joint
simulation, trajectory action, heartbeat, Rover ECAM aggregation, and
ROSbridge launch.

Run the local stack with:

```bash
docker compose up --build
```

The synthetic camera publisher remains the existing shell/GStreamer helper.
The Python implementation is retained only at `../mock_rover_python_legacy`
and excluded from Colcon.
