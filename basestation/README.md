# MoveIt 2 base station arm planning stack

This folder contains the MoveIt 2 base station stack for the current six-joint
arm. It runs MoveIt 2 in a base-station-style container and sends either
partial or complete, time-parameterized planned trajectories to the rover
through the standard `FollowJointTrajectory` action.

## Start

From this directory:

```bash
docker compose -f docker-compose.local.yml up --build
```

The stack starts:

- a headless MoveIt 2 `move_group` node with the `position_arm` and `arm`
  planning groups;
- an `arm_moveit_bridge` node that owns MoveIt2 planning and rover action
  execution;
- an identity `world` to `base_link` transform and robot state publisher;
- a MediaMTX gateway receiving rover RTSP streams on `8554` and serving WHEP
  playback on `8889` with WebRTC ICE on UDP `8189`.

This stack does not run a mock rover or ROSbridge. For local testing, start
`test/mock_rover` first, then start this stack. The GUI always connects to the
mock rover at:

```text
ws://localhost:9090
```

The mock rover's synthetic camera publishers send RTSP to this stack through
`host.docker.internal:8554`. The GUI reads the resulting WHEP feeds from
`http://localhost:8889`.

For production, Command copies `.env.example` to `.env` and starts the normal
Compose file with `docker compose -f docker-compose.yml up --build`. The rover must expose UDP port
`11811` at `rover.local`; the base station joins the rover automatically. The
rover camera pipeline must also be able to publish RTSP to the base station's
TCP `8554` listener.
`docker-compose.local.yml` is local-test-only.

The MoveIt container stays running after launch. In another terminal, run the
planning demo:

```bash
docker compose exec moveit2 bash -lc \
  'source /opt/ros/jazzy/setup.bash && \
   source /workspace/install/setup.bash && \
   ros2 run arm_moveit_demo plan_and_execute'
```

The GUI path is:

```text
GUI target pose
  -> /arm/target_pose
  -> arm_moveit_bridge
  -> MoveIt2 global planning + time parameterization
  -> /arm_controller/follow_joint_trajectory (J1-J3 or J1-J6)
  -> mock/real rover controller
  -> /joint_states
  -> GUI model viewer
```

`/arm/target_pose` uses `base_link` coordinates. Its position is the target for
`j4_pivot_link`, and its orientation is the desired `ee_link` orientation.
`/arm/orientation_lock` selects the execution path:

- `false` (UNLOCKED): position-only planning in the `position_arm` group generates a partial J1-J3
  trajectory; J4-J6 remain under `/arm/joy`.
- `true` (LOCKED): the full `arm` group generates a complete J1-J6 trajectory
  while constraining `ee_link` to the requested orientation.

While LOCKED, the GUI ignores joystick and trigger wrist input. The captured
EE orientation remains fixed until the operator unlocks, adjusts the wrist,
and locks again; digital button commands remain available.

For LOCKED requests, the bridge first solves the proximal `position_arm` group
and then uses that result as the J1-J3 goal for the full `arm` plan. This keeps
the J4-pivot and EE orientation requirements compatible with the configured
kinematics solver.

Both paths use smooth joint-space planning. Collision checking is disabled for
this first path; joint limits and rover-side safety checks remain active.

Moving the target while a trajectory is active cancels the current action and
causes the bridge to plan from the latest rover state. The GUI never schedules
trajectory points or publishes trajectory points. The browser-side FK model is
used for display only; MoveIt2 is the only Position mode solver.

To plan without execution:

```bash
docker compose exec moveit2 bash -lc \
  'source /opt/ros/jazzy/setup.bash && \
   source /workspace/install/setup.bash && \
   ros2 run arm_moveit_demo plan_and_execute --ros-args -p execute:=false'
```

Useful demo parameters:

```text
target_dx   X displacement in metres (default: 0.0)
target_dy   Y displacement in metres (default: 0.0)
target_dz   Z displacement in metres (default: 0.03)
execute     Send the planned trajectory to the mock rover (default: true)
```

## Responsibility boundary

```mermaid
flowchart TB
    gui[GUI ArmIkCoordinator]
    target[/arm/target_pose<br/>J4 pivot + EE orientation]
    lock[/arm/orientation_lock<br/>Bool]
    bridge[arm_moveit_bridge]
    mode{Orientation mode}
    unlocked[position_arm<br/>J1-J3 pivot goal]
    locked[arm<br/>J1-J6 pivot goal<br/>EE orientation constraint]
    time[MoveIt2 planning + time parameterization]
    status[/arm/moveit/status<br/>planning/execution state]
    action[FollowJointTrajectory<br/>/arm_controller]
    rover[Rover controller<br/>limits + execution]
    telemetry[/joint_states<br/>actual feedback]

    gui --> target --> bridge
    gui --> lock --> bridge
    bridge --> mode
    mode -->|UNLOCKED| unlocked --> time
    mode -->|LOCKED| locked --> time
    time --> action
    action --> rover
    bridge --> status
    status --> gui
    rover --> telemetry
    telemetry --> gui
```

The bridge publishes JSON status events on `/arm/moveit/status` using the
`std_msgs/msg/String` shape:

```json
{"request_id":1,"state":"EXECUTING","message":""}
```

`state` is one of `PLANNING`, `EXECUTING`, `SUCCEEDED`, `CANCELED`, or
`FAILED`. The request ID is carried in the target pose timestamp so stale
status events cannot complete a newer GUI request.

The checked-in URDF currently contains visual geometry but no collision
geometry. This stack therefore tests joint-space planning, joint-limit-aware
time parameterization, action execution, cancellation, and telemetry—not
real-world obstacle avoidance. OMPL remains configured for later
collision-aware planning mode.
