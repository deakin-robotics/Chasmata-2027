# Production rover

`prod_rover` is the production Rover implementation. It currently preserves the
mock Rover behaviour while real hardware components are introduced incrementally.

Run the local stack with:

```bash
ros2 launch prod_rover rover.launch.xml
```

The synthetic camera publisher remains the existing shell/GStreamer helper.
