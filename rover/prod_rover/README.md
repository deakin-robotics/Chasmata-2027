# Production rover

`prod_rover` is the production Rover implementation. It currently preserves the
mock Rover behaviour while real hardware components are introduced incrementally.

Run the local stack with:

```bash
ros2 launch rover_mode_switch rover.launch.xml mode:=prod
```

The synthetic camera publisher remains the existing shell/GStreamer helper.
