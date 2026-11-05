# Production rover

`prod_rover` is the production Rover implementation. It starts Rover Control,
Arm Control, the real C++ arm driver, controller manager, and the SocketCAN
bridge. `/arm/joint_states` is measured hardware feedback; Position trajectories
come from BaseStation MoveIt through `arm_controller`.

Run the local stack with:

```bash
ros2 launch prod_rover rover.launch.xml
```

The synthetic camera publisher remains the existing shell/GStreamer helper.

## Arm CAN interface

The production launch currently uses `can0`. Verify this on the real Rover PC
before arm testing and change the launch/URDF configuration if its arm bus uses
a different SocketCAN interface.
