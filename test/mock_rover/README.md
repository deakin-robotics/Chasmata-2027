# Mock rover

This is a small ROS 2 Jazzy rover simulator for GUI integration testing. It
behaves like a rover-side feedback node rather than changing the Angular GUI's
connection logic.

## Run it

From this directory:

```bash
docker compose up --build
```

The container runs the mock node and ROSbridge on port `9090`. Connect the GUI
to:

```text
ws://localhost:9090
```

## Simulated behaviour

- Starts with LAW `NORMAL`, SYSTEM `GOOD`, LINK `GOOD`, and unknown Gimbal
  priority.
- Accepts valid Driver and Arm mode requests, publishes them as pending, then
  confirms them after 150 ms.
- Publishes a complete FMA state immediately and once per second for late
  subscribers/recovery.
- Accepts arm joint targets, clamps them to the current six-joint limits, and
  moves each simulated joint toward its target at a configurable speed.
- Publishes actual arm state on `/joint_states` at 20 Hz.

The default joint names match the current GUI URDF:

```text
base_joint, shoulder_joint, elbow_joint, yaw_joint, pitch_joint, roll_joint
```

## Topics

| Direction | Topic | Type | Purpose |
| --- | --- | --- | --- |
| GUI → mock rover | `/joint_commands` | `sensor_msgs/msg/JointState` | Target joint positions in radians. |
| Mock rover → GUI | `/joint_states` | `sensor_msgs/msg/JointState` | Simulated actual joint positions and velocities. |
| GUI → mock rover | `/fma/drive/request` | `std_msgs/msg/String` | Driver mode value, such as `VELOCITY`. |
| GUI → mock rover | `/fma/arm/request` | `std_msgs/msg/String` | Arm mode value, such as `POSITION`. |
| Mock rover → GUI | `/fma/state` | `std_msgs/msg/String` | JSON FMA telemetry broadcast. |

The provisional `/fma/state` JSON shape is:

```json
{
  "schema": "dcr/fma-state/v1",
  "sequence": 12,
  "drive": {"confirmed": "VELOCITY", "pending": null, "rejected": null},
  "arm": {"confirmed": "POSITION", "pending": null, "rejected": null},
  "law": "NORMAL",
  "system": "GOOD",
  "link": "GOOD",
  "gimbal_priority": null
}
```

This JSON is deliberately provisional. It keeps the mock usable before the
Control team finalises the production FMA message definition. The GUI should
replace this adapter with the final message type when that contract is agreed;
the mock's feedback responsibilities stay the same.

## Parameters

```bash
ros2 run mock_rover mock_rover --ros-args \
  -p joint_speed_rad_s:=1.0 \
  -p publish_rate_hz:=20.0 \
  -p mode_ack_delay_ms:=150.0
```

The mock does not model wheel motion, CAN, camera streams, or MoveIt 2. Its
purpose is the smallest useful end-to-end feedback loop for the GUI.
