# MoveIt 2 Cartesian trajectory test stack

This folder is an isolated MoveIt 2 experiment for the current six-joint arm.
It runs MoveIt 2 in a base-station-style container and sends either partial or
complete, time-parameterized Cartesian trajectories to the mock rover through
the standard `FollowJointTrajectory` action.

## Start

From this directory:

```bash
docker compose up --build
```

The stack starts:

- an isolated mock rover and ROSbridge on `ws://localhost:19090`;
- a headless MoveIt 2 `move_group` node with the `position_arm` and `arm`
  planning groups;
- an `arm_moveit_bridge` node that owns Cartesian planning and rover action
  execution;
- an identity `world` to `base_link` transform and robot state publisher.

If the GUI should connect to this isolated rover, use `localhost:19090` as its
ROSbridge endpoint. The port defaults can be overridden with
`MOVEIT2_ROSBRIDGE_PORT`, `MOVEIT2_FRONT_CAMERA_PORT`,
`MOVEIT2_GIMBAL_CAMERA_PORT`, and `MOVEIT2_ARM_CAMERA_PORT`.

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
  -> J4-pivot Cartesian interpolation + MoveIt IK + time parameterization
  -> /arm_controller/follow_joint_trajectory (J1-J3 or J1-J6)
  -> mock/real rover controller
  -> /joint_states
  -> GUI model viewer
```

`/arm/target_pose` uses `base_link` coordinates. Its position is the target for
`j4_pivot_link`, and its orientation is the desired `ee_link` orientation.
`/arm/orientation_lock` selects the execution path:

- `false` (UNLOCKED): position-only IK in the `position_arm` group generates a partial J1-J3
  trajectory; J4-J6 remain under `/arm/joy`.
- `true` (LOCKED): the full `arm` group generates a complete J1-J6 trajectory
  while constraining `ee_link` to the requested orientation.

Both paths use a straight J4-pivot Cartesian path. Collision checking is
disabled for this first path; joint limits and rover-side safety checks remain
active.

Moving the target while a trajectory is active cancels the current action and
causes the bridge to plan from the latest rover state. The GUI never schedules
trajectory points and does not publish `/joint_commands` while the MoveIt2
provider is selected. The closed-chain provider remains available as the fast
direct-joint fallback.

To plan without execution:

```bash
docker compose exec moveit2 bash -lc \
  'source /opt/ros/jazzy/setup.bash && \
   source /workspace/install/setup.bash && \
   ros2 run arm_moveit_demo plan_and_execute --ros-args -p execute:=false'
```

Useful demo parameters:

```text
target_dx   Cartesian X displacement in metres (default: 0.0)
target_dy   Cartesian Y displacement in metres (default: 0.0)
target_dz   Cartesian Z displacement in metres (default: 0.03)
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
    unlocked[position_arm<br/>J1-J3 pivot path]
    locked[arm<br/>J1-J6 pivot path<br/>EE orientation constraint]
    time[IK + time parameterization]
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
geometry. This stack therefore tests Cartesian kinematics, joint-limit-aware
time parameterization, action execution, cancellation, and telemetry—not
real-world obstacle avoidance. OMPL remains configured in MoveIt2 for a later
collision-aware planning mode.
