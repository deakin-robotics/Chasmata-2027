# MoveIt 2 test stack

This folder is an isolated MoveIt 2 experiment for the current six-joint arm.
It runs MoveIt 2 in a base-station-style container and connects it to the
mock rover through the standard `FollowJointTrajectory` action. The GUI is not
changed by this test stack.

## Start

From this directory:

```bash
docker compose up --build
```

The stack starts:

- an isolated mock rover and ROSbridge on `ws://localhost:19090`;
- a headless MoveIt 2 `move_group` node with the `arm` planning group;
- an identity `world` to `base_link` transform and robot state publisher.

The alternate host ports let this stack run beside the normal
`test/mock_rover` compose. If the GUI should connect to this isolated rover,
use `localhost:19090` as its ROSbridge endpoint. The port defaults can be
overridden with `MOVEIT2_ROSBRIDGE_PORT`, `MOVEIT2_FRONT_CAMERA_PORT`,
`MOVEIT2_GIMBAL_CAMERA_PORT`, and `MOVEIT2_ARM_CAMERA_PORT`.

The MoveIt container stays running after launch. In another terminal, run the
planning demo:

```bash
docker compose exec moveit2 bash -lc \
  'source /opt/ros/jazzy/setup.bash && \
   source /workspace/install/setup.bash && \
   ros2 run arm_moveit_demo plan_and_execute'
```

The CLI demo plans a small Z displacement from the current end-effector pose
and, by default, executes the resulting trajectory. The mock rover accepts the
trajectory, immediately publishes its final joint state on `/joint_states`,
and the GUI can render that telemetry through ROSbridge. The GUI is not wired
to MoveIt 2 yet; this stack proves the planner-to-rover boundary first.

To plan without execution:

```bash
docker compose exec moveit2 bash -lc \
  'source /opt/ros/jazzy/setup.bash && \
   source /workspace/install/setup.bash && \
   ros2 run arm_moveit_demo plan_and_execute --ros-args -p execute:=false'
```

Useful parameters:

```text
target_dx   Cartesian X displacement in metres (default: 0.0)
target_dy   Cartesian Y displacement in metres (default: 0.0)
target_dz   Cartesian Z displacement in metres (default: 0.03)
execute     Send the planned trajectory to the mock rover (default: true)
```

## Responsibility boundary

```mermaid
flowchart LR
    demo[CLI target request]
    move_group[MoveIt 2<br/>move_group]
    planner[OMPL planner<br/>time parameterization]
    action[FollowJointTrajectory<br/>/arm_controller]
    rover[Mock rover<br/>limit + execute]
    telemetry[/joint_states]

    demo --> move_group
    move_group --> planner
    planner --> action
    action --> rover
    rover --> telemetry
    telemetry --> gui[GUI through ROSbridge]
```

This test package uses the current GUI URDF as a checked-in test copy. When
the mechanical model changes, update `arm_moveit_config/config/arm.urdf` and
regenerate or review the MoveIt configuration before trusting plans on real
hardware.

The copied URDF currently contains visual geometry but no collision geometry,
so this first probe tests joint-limit-aware kinematic planning, time
parameterization, action execution, and telemetry—not collision avoidance.
Adding collision geometry and scene objects is a separate follow-up.

The test intentionally does not modify the production GUI's current
`ArmIkCoordinator` contract yet. It proves that MoveIt 2 can plan and execute
a trajectory through the rover-side boundary first.
