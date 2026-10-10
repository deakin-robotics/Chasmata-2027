# Rover control contract scaffold

This package is the production-side owner of the rover-wide ROS contract used
by the GUI and the MoveIt 2 base station. It is intentionally a safe scaffold:
the node declares the interfaces but does not simulate movement, publish fake
telemetry, acknowledge modes, or report successful commands.

The executable is `rover_control_node`, and it can be launched with:

```bash
ros2 launch rover_control rover_control.launch.py
```

## Contract

| Direction | Interface | Type | Current scaffold behavior |
| --- | --- | --- | --- |
| Control/GUI → rover | `/joint_commands` | `sensor_msgs/msg/JointState` | Logs `TODO(Control)`; no movement |
| Control/GUI → rover | `/joy` | `sensor_msgs/msg/Joy` | Logs `TODO(Control)`; no drivetrain command |
| Control/GUI → rover | `/arm/joy` | `sensor_msgs/msg/Joy` | Logs `TODO(Control)`; no arm command |
| Control/GUI → rover | `/arm/orientation_lock` | `std_msgs/msg/Bool` | Logs `TODO(Control)`; no state change |
| GUI → rover | `/fma/drive/request` | `std_msgs/msg/String` | Logs `TODO(Control)`; no acknowledgement |
| GUI → rover | `/fma/arm/request` | `std_msgs/msg/String` | Logs `TODO(Control)`; no acknowledgement |
| GUI → rover | `/arm/override/request` | `std_msgs/msg/String` | Logs `TODO(Control)`; no acknowledgement |
| GUI → rover | `/fma/gimbal/request` | `std_msgs/msg/String` | Logs `TODO(Control)`; no acknowledgement |
| MoveIt 2 → rover | `/arm_controller/follow_joint_trajectory` | `control_msgs/action/FollowJointTrajectory` | Rejects goals until six-joint hardware is connected |
| rover → GUI | `/joint_states` | `sensor_msgs/msg/JointState` | Advertised but never published by the scaffold |
| rover → GUI | `/fma/state` | `std_msgs/msg/String` | Advertised but never published by the scaffold |

The arm contract is six-joint: `base_joint`, `shoulder_joint`, `elbow_joint`,
`yaw_joint`, `pitch_joint`, and `roll_joint`. The mock rover in
`test/mock_rover` remains the executable GUI test double and currently provides
the simulated trajectory, telemetry, mode, override, and Gimbal behavior.

This package does not contain ROSbridge, MediaMTX, camera sources, Docker
configuration, or the arm/drivetrain hardware drivers. Control hardware
packages should implement the TODO handlers and connect their verified
feedback to the two output interfaces.
