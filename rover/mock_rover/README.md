# Mock rover

`mock_rover` is the rover-side arm simulator. Rover Control, ECAM aggregation,
and ROSbridge are started by `rover_bringup`.

Run the local stack with:

```bash
ros2 launch rover_bringup rover.launch.xml mode:=dev
```

The synthetic camera publisher remains the existing shell/GStreamer helper.
