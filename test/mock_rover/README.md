# Mock rover

This is a small ROS 2 Jazzy rover simulator for GUI integration testing. It
behaves like a rover-side feedback node rather than changing the Angular GUI's
connection logic.

## Run it

From this directory:

```bash
docker compose up --build
```

The container runs the mock node and ROSbridge on port `9090`, plus three canned
camera endpoints on ports `8080`, `8090`, and `8091`. Connect the GUI normally
to:

```text
ws://localhost:9090
```

The GUI dashboards use these legacy-shaped camera feeds automatically:

```text
Front camera:  http://localhost:8080/?action=stream
Arm camera:    http://localhost:8091/?action=stream
Gimbal camera: http://localhost:8090/?action=stream
```

## Simulated behaviour

- Starts with LAW `NORMAL`, SYSTEM `GOOD`, and unknown Gimbal priority.
- Accepts valid Driver and Arm mode requests, publishes them as pending, then
  confirms them after 150 ms.
- Accepts Arm Override commands on `/arm/override/request`, broadcasts them as
  pending, then confirms them after 150 ms. `ENABLE` disables rover-side soft
  protection and `DISABLE` restores it. LAW is calculated independently from
  protection availability.
- Accepts temporary Gimbal priority requests on `/fma/gimbal/request`,
  broadcasts them as pending, then confirms them after 150 ms. The confirmed
  owner keeps the directional arrow; a pending owner is shown separately in
  blue. The latest valid request wins.
- Publishes a complete FMA state immediately and once per second for late
  subscribers/recovery.
- Accepts legacy named arm joint targets, clamps them to the current six-joint
  limits, and immediately publishes the accepted positions as rover telemetry.
  Position mode itself uses MoveIt2 trajectories for proximal joints.
- Accepts `FollowJointTrajectory` goals on
  `/arm_controller/follow_joint_trajectory`. In UNLOCKED mode it accepts a
  partial J1-J3 goal; in LOCKED mode it requires all six joints. It validates
  every point against the rover joint limits, interpolates the points over
  their timestamps, and publishes the simulated actual positions and
  velocities while executing. New goals can cancel an active trajectory.
- Accepts `/arm/orientation_lock` and simulates Arm `/arm/joy` input. In
  MANUAL mode it applies the direct J1-J6 command; in Position-mode UNLOCKED
  it applies only the J4-J6 wrist input. Partial trajectory execution
  preserves the other joints.
- Publishes actual arm state on `/joint_states` at 10 Hz.
- Serves canned GIF feeds through the legacy HTTP camera endpoint shape.

The default joint names match the current GUI URDF:

```text
base_joint, shoulder_joint, elbow_joint, yaw_joint, pitch_joint, roll_joint
```

## Topics

| Direction | Topic | Type | Purpose |
| --- | --- | --- | --- |
| GUI → mock rover | `/joy` | `sensor_msgs/msg/Joy` | Driver gamepad input; LT/RT are analogue `axes[4]`/`axes[5]` values in the range `0..1`. |
| GUI → mock rover | `/arm/joy` | `sensor_msgs/msg/Joy` | Manual Arm gamepad input; LT/RT are analogue `axes[8]`/`axes[9]` values in the range `0..1`. |
| GUI → mock rover | `/joint_commands` | `sensor_msgs/msg/JointState` | Target joint positions in radians. |
| GUI → mock rover | `/arm/orientation_lock` | `std_msgs/msg/Bool` | Selects Position-mode UNLOCKED (`false`) or LOCKED (`true`) execution. |
| MoveIt2 → mock rover | `/arm_controller/follow_joint_trajectory` | `control_msgs/action/FollowJointTrajectory` | Timed J1-J3 partial trajectory in UNLOCKED mode or complete J1-J6 trajectory in LOCKED mode. |
| Mock rover → GUI | `/joint_states` | `sensor_msgs/msg/JointState` | Simulated actual joint positions and velocities. |
| GUI → mock rover | `/fma/drive/request` | `std_msgs/msg/String` | Driver mode value, such as `VELOCITY`. |
| GUI → mock rover | `/fma/arm/request` | `std_msgs/msg/String` | Arm mode value, such as `POSITION`. |
| GUI → mock rover | `/arm/override/request` | `std_msgs/msg/String` | Arm Override command: `ENABLE` or `DISABLE`. |
| GUI → mock rover | `/fma/gimbal/request` | `std_msgs/msg/String` | Temporary Gimbal priority request: `DRIVER` or `ARM OPS`. |
| Mock rover → GUI | `/fma/state` | `std_msgs/msg/String` | JSON FMA telemetry broadcast. |

For both Joy topics, `buttons[]` contains only digital button values (`0` or
`1`). LT and RT are not read from `buttons[]`; their browser analogue values
are sent through the dedicated axes listed above.

In Arm MANUAL mode, `/arm/joy` uses `axes[0]`/`axes[1]` for J1/J2,
`axes[4]` for J3, `axes[6]`/`axes[7]` for J4/J5, and
`axes[9] - axes[8]` for J6. While LB is held, the GUI reserves the right-stick
channels for its Gimbal modifier, so the mock does not apply `axes[4]` to J3.
The left-stick wrist and trigger controls remain active.

In Position-mode UNLOCKED operation, `/arm/joy` uses `axes[6]` for J4 yaw,
`axes[7]` for J5 pitch, and `axes[8]`/`axes[9]` for J6 roll. The GUI places
the Position-mode left-stick yaw/pitch values into those wrist axes. In
LOCKED operation the GUI sends zero wrist axes; joystick and trigger input is
ignored and the captured EE orientation remains fixed. Digital buttons remain
available.

The provisional `/fma/state` JSON shape is:

```json
{
  "schema": "dcr/fma-state/v1",
  "sequence": 12,
  "drive": {"confirmed": "VELOCITY", "pending": null, "rejected": null},
  "arm": {"confirmed": "POSITION", "pending": null, "rejected": null},
  "law": "NORMAL",
  "arm_override": {"state": "INACTIVE", "pending": null},
  "system": "GOOD",
  "gimbal_priority": {"confirmed": null, "pending": null, "rejected": null}
}
```

This JSON and the `/arm/override/request` and `/fma/gimbal/request` topics are
deliberately provisional. They keep the mock usable before the Control team
finalises the production FMA message definitions. The GUI should replace this
adapter with the final message types when those contracts are agreed; the
mock's feedback responsibilities stay the same.

## Parameters

```bash
ros2 run mock_rover mock_rover --ros-args \
  -p publish_rate_hz:=10.0 \
  -p mode_ack_delay_ms:=150.0
```

The mock does not model wheel motion, CAN, camera movement, or MoveIt 2. Its
purpose is the smallest useful end-to-end feedback loop for the GUI.
