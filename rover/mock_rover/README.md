# Mock rover

This is a small ROS 2 Jazzy rover simulator for GUI integration testing. It
behaves like a rover-side feedback node rather than changing the Angular GUI's
connection logic.

## Run it

From this directory:

```bash
docker compose up --build
```

The Compose stack runs the mock node, the Rover-primary ECAM snapshot
aggregator, and ROSbridge on port `9090`, a rover-side discovery service on UDP
port `11811`, and three synthetic H.264 WebRTC publishers. The BaseStation
stack consumes ROSbridge and camera streams. The hosted operator GUI connects
through the BaseStation web proxy.

The mock rover and base-station stacks can start in either order. The mock
rover ROS services use host networking, so the base station can reach the
rover-side discovery server at UDP `11811` without a shared Docker network.
On Windows, enable Docker Desktop host networking (Docker Desktop 4.34 or
newer) to run this local setup. The GUI still uses `ws://localhost:9090` for
local testing.
The ROS containers also share host IPC. Fast DDS uses shared memory between
containers it detects on the same host; host networking without shared IPC can
leave ROSbridge unable to receive topics from another container.

For direct WebRTC camera publishing between the two local Compose stacks,
create their shared Docker network once before starting either stack:

```bash
docker network create chasmata-local-media
```

The synthetic publishers connect directly to Base station MediaMTX over the
shared Docker network. When the mock rover runs on a separate PC, set
`BASE_STATION_MEDIA_HOST` to the Base station's static radio/LAN IP. WHIP
signalling uses TCP `8889` and WebRTC media uses UDP `8189`.

To publish synthetic feeds to a differently named Base station media service,
set `BASE_STATION_MEDIA_HOST` and `BASE_STATION_MEDIA_PORT`:

```bash
BASE_STATION_MEDIA_HOST=media-gateway BASE_STATION_MEDIA_PORT=8889 docker compose up --build
```

The default synthetic profile is 1280×720 at 30 FPS using H.264. Override it
with `MEDIA_WIDTH`, `MEDIA_HEIGHT`, `MEDIA_FPS`, `MEDIA_BITRATE_KBPS`,
`MEDIA_BUFFER_KBPS`, `MEDIA_KEYFRAME_INTERVAL`, `BASE_STATION_MEDIA_HOST`, and
`BASE_STATION_MEDIA_PORT`.

## Simulated behaviour

- Publishes `/rover/heartbeat` after setting up its ROS interfaces, then once
  per second. The GUI waits for this before enabling rover controls.
- Starts with LAW `NORMAL`, SYSTEM `GOOD`, and unknown Gimbal priority.
- Accepts valid Driver and Arm mode requests, publishes them as pending, then
  confirms them after 150 ms.
- Accepts Arm Override commands on `/arm/override/request`, broadcasts them as
  pending, then confirms them after 150 ms. `ENABLE` disables rover-side soft
  protection and `DISABLE` restores it. LAW is calculated independently from
  protection availability.
- Accepts temporary Gimbal priority requests on `/fma/gimbal/request`,
  broadcasts them as pending, then confirms them after 150 ms. The confirmed
  owner keeps the directional arrow. A pending owner is shown separately in
  blue. The latest valid request wins.
- Publishes a complete FMA state immediately and once per second for late
  subscribers/recovery.
- Accepts legacy named arm joint targets, clamps them to the current six-joint
  limits, and immediately publishes the accepted positions as rover telemetry.
  Position mode itself uses MoveIt2 trajectories for proximal joints.
- Accepts `FollowJointTrajectory` goals on
  `/arm_controller/follow_joint_trajectory`. In UNLOCKED mode it accepts a
  partial J1-J3 goal. In LOCKED mode it requires all six joints. It validates
  every point against the rover joint limits, interpolates the points over
  their timestamps, and publishes the simulated actual positions and
  velocities while executing. New goals can cancel an active trajectory.
- Accepts `/arm/orientation_lock` and simulates Arm `/arm/joy` input. In
  MANUAL mode it applies the direct J1-J6 command. In Position-mode UNLOCKED
  it applies only the J4-J6 wrist input. Partial trajectory execution
  preserves the other joints.
- Publishes actual arm state on `/arm/joint_states` at 10 Hz.
- Publishes distinct synthetic H.264 WHIP/WebRTC feeds directly to Base station
  MediaMTX's `front`, `gimbal`, and `arm` paths for browser playback through
  the hosted BaseStation GUI.

The default joint names match the current GUI URDF:

```text
base_joint, shoulder_joint, elbow_joint, yaw_joint, pitch_joint, roll_joint
```

## ROS interface behavior

The shared interface names and starting definitions are documented in the
[ROS interface catalog](../../docs/ros-interface-contract.md). This section
describes mock-specific behavior and mappings. It does not make those details
the final production contract.

For both Joy topics, `buttons[]` contains only digital button values (`0` or
`1`). LT and RT are not read from `buttons[]`. Their browser analogue values
are sent through the dedicated axes listed above.

In Arm MANUAL mode, `/arm/joy` uses `axes[0]`/`axes[1]` for J1/J2,
`axes[4]` for J3, `axes[6]`/`axes[7]` for J4/J5, and
`axes[9] - axes[8]` for J6. While LB is held, the GUI reserves the right-stick
channels for its Gimbal modifier, so the mock does not apply `axes[4]` to J3.
The left-stick wrist and trigger controls remain active.

In Position-mode UNLOCKED operation, `/arm/joy` uses `axes[6]` for J4 yaw,
`axes[7]` for J5 pitch, and `axes[8]`/`axes[9]` for J6 roll. The GUI places
the Position-mode left-stick yaw/pitch values into those wrist axes. In
LOCKED operation the GUI sends zero wrist axes. Joystick and trigger input is
ignored and the captured EE orientation remains fixed. Digital buttons remain
available.

The mock publishes `/fma/state` as `telemetry_interfaces/msg/FmaState`. Its
nested mode and override fields use `FmaModeState` and `ArmOverrideState`.
String fields that were `null` in the prior payload are published as empty
strings. For example:

```yaml
schema: dcr/fma-state/v1
sequence: 12
drive: { confirmed: VELOCITY, pending: "", rejected: "" }
arm: { confirmed: POSITION, pending: "", rejected: "" }
law: NORMAL
arm_override: { state: INACTIVE, pending: "" }
system: GOOD
gimbal_priority: { confirmed: "", pending: "", rejected: "" }
```

The `/arm/override/request` and `/fma/gimbal/request` topics remain separate
command interfaces. The mock's feedback behavior is unchanged.

## Parameters

```bash
ros2 run mock_rover mock_rover --ros-args \
  -p publish_rate_hz:=10.0 \
  -p mode_ack_delay_ms:=150.0
```

The mock does not model wheel motion, CAN, camera movement, or MoveIt 2. Its
purpose is the smallest useful end-to-end feedback loop for the GUI.
