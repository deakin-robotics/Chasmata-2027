# Arm MoveIt planning

The base station plans Arm Position/IK movements. It receives a target pose
from the GUI, plans a safe-in-joint-space trajectory, then sends the trajectory
to the rover. The rover remains responsible for executing it and reporting
actual joint feedback.

## Packages

| Package | Role |
| --- | --- |
| `arm_moveit_config` | Robot description, joint limits, controller configuration, planning configuration, and launch file. |
| `arm_moveit_bridge` | Connects GUI requests, MoveIt planning, rover trajectory execution, and status events. |
| `arm_moveit_demo` | Developer command-line program for manually planning and optionally executing a test movement. |

## Position/IK flow

```text
GUI target pose
  -> /arm/target_pose
  -> arm_moveit_bridge
  -> MoveIt planning and time parameterization
  -> /arm_controller/follow_joint_trajectory
  -> rover controller
  -> /joint_states
  -> GUI model viewer
```

`/arm/target_pose` uses `base_link` coordinates. Its position targets
`j4_pivot_link`; its orientation is the requested `ee_link` orientation.
MoveIt, not the browser FK model, is the Position mode solver. The browser
model is display-only.

### Orientation modes

- **UNLOCKED** (`/arm/orientation_lock = false`): MoveIt plans the
  `position_arm` group (J1-J3) for the pivot position. J4-J6 stay under
  `/arm/joy` control.
- **LOCKED** (`/arm/orientation_lock = true`): MoveIt plans the full `arm`
  group (J1-J6) while constraining `ee_link` to the requested orientation.

While locked, joystick and trigger wrist input is ignored. The captured end
effector orientation stays fixed until the operator unlocks, changes the
wrist, and locks again. Digital button commands remain available.

For a locked request, the bridge first solves the proximal `position_arm`
group, then uses that J1-J3 result as the target for the full-arm plan. This
keeps the configured pivot and end-effector orientation requirements aligned.

If a new target arrives while a trajectory is active, the bridge cancels that
action and replans from the latest rover state.

## Manual demo

Leave the base-station stack running, then use another terminal:

```bash
docker compose exec moveit2 bash -lc \
  'source /opt/ros/jazzy/setup.bash && \
   source /workspace/install/setup.bash && \
   ros2 run arm_moveit_demo plan_and_execute'
```

Plan only, without sending a trajectory to the rover:

```bash
docker compose exec moveit2 bash -lc \
  'source /opt/ros/jazzy/setup.bash && \
   source /workspace/install/setup.bash && \
   ros2 run arm_moveit_demo plan_and_execute --ros-args -p execute:=false'
```

| Parameter | Meaning | Default |
| --- | --- | --- |
| `target_dx` | X displacement in metres | `0.0` |
| `target_dy` | Y displacement in metres | `0.0` |
| `target_dz` | Z displacement in metres | `0.03` |
| `execute` | Send the planned trajectory to the rover | `true` |

## Status events

The bridge publishes JSON strings on `/arm/moveit/status`:

```json
{"request_id":1,"state":"EXECUTING","message":""}
```

`state` is `PLANNING`, `EXECUTING`, `SUCCEEDED`, `CANCELED`, or `FAILED`.
The request ID is carried in the target pose timestamp, so a stale status event
cannot complete a newer GUI request.

## Current collision boundary

Both orientation modes use smooth joint-space planning. Collision checking is
currently disabled: the checked-in URDF has visual geometry but no collision
geometry. Joint limits and rover-side safety checks remain active. This stack
therefore validates planning, time parameterization, execution, cancellation,
and feedback—not real-world obstacle avoidance.

OMPL remains configured for a future collision-aware planning mode.
