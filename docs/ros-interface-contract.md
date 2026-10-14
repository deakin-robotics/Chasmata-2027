# ROS interface contract

These ROS names, message types, field mappings, and state values are the shared
interface for GUI, base station, and rover Control. The mock rover implements
this interface today. The real rover replaces its simulated behavior behind the
same interface. Indices below are zero based. Arm joint positions and velocities
use radians and radians per second unless a field says otherwise.

The contract field describes only the message or action payload sent over ROS.
The behavior field describes how participants produce, interpret, and validate
that payload. The purpose field explains why an interface exists.

## Sample topic entry

This is an illustrative entry, not a topic implemented by the rover. Each
root field has a description in the comment immediately above it. The comments
are documentation only and keep the example in the same format as the real
entries below.

```yaml
# The exact ROS topic name used by publishers and subscribers.
topic: /example/status

# The ROS message type carried by this topic.
type: std_msgs/msg/String

# The component that sends the message.
publisher: Example node

# The component that receives the message.
subscriber: Example client

# The fields and values actually sent in the ROS message.
contract:
  data: {type: string, enum: [READY, BUSY]}

# How the sender and receiver use the payload.
behavior:
  publish_on_state_change: true

# Why this interface exists, in plain language.
purpose: Tells a client whether the example node is ready or busy.
```

## Topics

### Rover heartbeat

```yaml
topic: /rover/heartbeat
type: std_msgs/msg/Empty
publisher: Rover Control
subscriber: GUI
contract: {}
behavior:
  publish_after_interfaces_ready: true
  publish_rate_hz: 1
  qos: {reliability: reliable, durability: volatile, depth: 1}
  gui_ready_on_first_message: true
  gui_timeout_seconds: 3
purpose: Provides a periodic signal that subscribers use to detect whether Rover Control is reachable.
```

Example message:

```yaml
{}
```

The rover publishes this heartbeat so subscribers can detect whether Rover
Control remains reachable through ROS. If the messages stop, subscribers can
treat Rover Control as unavailable independently of base-station connectivity.

### Base-station heartbeat

```yaml
topic: /basestation/heartbeat
type: std_msgs/msg/Empty
publisher: Base-station arm MoveIt bridge
contract: {}
behavior:
  publish_on_bridge_startup: true
  publish_rate_hz: 1
  qos: {reliability: reliable, durability: volatile, depth: 1}
purpose: Provides a periodic signal that subscribers use to detect whether the base-station arm bridge is reachable.
```

Example message:

```yaml
{}
```

The base station publishes this heartbeat so subscribers can detect whether
the arm MoveIt bridge remains reachable through ROS. If the messages stop,
subscribers can treat the bridge as unavailable independently of rover
connectivity.

### Driver input

```yaml
topic: /drive/joy
type: sensor_msgs/msg/Joy
publisher: GUI
subscriber: Rover Control
contract:
  header:
    stamp: {sec: 0, nanosec: 0}
    frame_id: ""
  axes:
    type: float32[]
  buttons:
    type: int32[]
behavior:
  axes:
    min_length: 6
    indices:
      "0..3": gamepad.axes[0..3]
      "4": left_trigger
      "5": right_trigger
    trigger_range: [0.0, 1.0]
    trigger_sources:
      left: gamepad.buttons[6]
      right: gamepad.buttons[7]
  buttons:
    values: [0, 1]
    trigger_indices_zeroed: [6, 7]
  publish_rate_hz: 50
  active_control: driver
  valid_input:
    axes_finite: true
    buttons_digital: true
purpose: Driver gamepad input. LT/RT are analogue axes[4]/axes[5] values in the range 0..1.
```

Example message:

```yaml
header:
  stamp: {sec: 0, nanosec: 0}
  frame_id: ""
axes: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
buttons: [0, 0, 0, 0, 0, 0, 0, 0]
```

The GUI currently appends triggers after every browser gamepad axis. The
indices above match its output when the gamepad exposes four raw axes.

### Arm gamepad input

```yaml
topic: /arm/joy
type: sensor_msgs/msg/Joy
publisher: GUI
subscriber: Rover Control
contract:
  header:
    stamp: {sec: 0, nanosec: 0}
    frame_id: ""
  axes:
    type: float32[]
  buttons:
    type: int32[]
behavior:
  axes:
    length: 10
    indices:
      "0": manual_base
      "1": manual_shoulder
      "3": gimbal_horizontal
      "4": manual_elbow_or_gimbal_vertical
      "6": wrist_yaw
      "7": wrist_pitch
      "8": right_trigger
      "9": left_trigger
    trigger_range: [0.0, 1.0]
    trigger_sources:
      "8": gamepad.buttons[7]
      "9": gamepad.buttons[6]
  buttons:
    length: 12
    values: [0, 1]
    source_indices: [0, 1, 3, 2, 4, 5, null, null, 8, 9, 16, 11]
    index_10_fallback_source: gamepad.buttons[10]
    fixed_zero_indices: [6, 7]
    left_bumper_index: 4
    clear_faults_index: 10
  joint_jog:
    manual:
      base_joint: axes[0]
      shoulder_joint: axes[1]
      elbow_joint: axes[4]
      yaw_joint: axes[6]
      pitch_joint: axes[7]
      roll_joint: axes[9] - axes[8]
      elbow_disabled_when: buttons[4] == 1
    position_unlocked:
      yaw_joint: axes[6]
      pitch_joint: axes[7]
      roll_joint: axes[9] - axes[8]
    position_locked: no_joint_jog
  publish_rate_hz: 50
  active_control: arm
  valid_input:
    axes_finite: true
    buttons_digital: true
purpose: Manual Arm gamepad input. LT/RT are analogue axes[8]/axes[9] values in the range 0..1.
```

Example message:

```yaml
header:
  stamp: {sec: 0, nanosec: 0}
  frame_id: ""
axes: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
buttons: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
```

The mock integrates each nonzero Arm axis using a 0.02 second step and
0.5 rad/s per unit. That is simulator motion behavior.

### Arm joint targets

```yaml
topic: /arm/joint_commands
type: sensor_msgs/msg/JointState
publisher: ROS joint command client
subscriber: Rover Control
contract:
  header: {type: std_msgs/msg/Header}
  name: {type: string[]}
  position: {type: float64[], unit: rad}
  velocity: {type: float64[], unit: rad/s}
  effort: {type: float64[]}
behavior:
  position_min_length: 1
  named_positions:
    required_length: position.length
    unknown_names: ignore
  unnamed_positions:
    required_length: 6
    joint_order: [base_joint, shoulder_joint, elbow_joint, yaw_joint, pitch_joint, roll_joint]
  joint_limits_deg:
    base_joint: [-185, 185]
    shoulder_joint: [-5, 185]
    elbow_joint: [-5, 275]
    yaw_joint: [-95, 185]
    pitch_joint: [-5, 215]
    roll_joint: [-185, 185]
  ignored_fields: [header, velocity, effort]
purpose: Target joint positions in radians.
```

Example message:

```yaml
header:
  stamp: {sec: 0, nanosec: 0}
  frame_id: ""
name: [base_joint]
position: [0.1]
velocity: []
effort: []
```

The current GUI has no publisher for /arm/joint_commands.
The mock clamps known joints to its configured limits and immediately mirrors
accepted targets into /arm/joint_states.

### Arm orientation lock

```yaml
topic: /arm/orientation_lock
type: std_msgs/msg/Bool
publisher: GUI
subscriber: Rover Control and base-station MoveIt bridge
contract:
  data: {type: bool}
behavior:
  data:
    values: {false: UNLOCKED, true: LOCKED}
  unlocked_trajectory_joints: nonempty_subset_of_J1_to_J3_or_all_J1_to_J6
  locked_trajectory_joints: all_J1_to_J6
purpose: Selects Position-mode UNLOCKED (false) or LOCKED (true) execution.
```

Example message:

```yaml
data: true
```

### MoveIt target pose

```yaml
topic: /arm/target_pose
type: geometry_msgs/msg/PoseStamped
publisher: GUI Arm MoveIt provider
subscriber: Base-station MoveIt bridge
contract:
  header:
    frame_id: base_link
    stamp:
      sec: {type: int32}
      nanosec: {type: uint32}
  pose:
    position: {fields: [x, y, z], type: float64, unit: m}
    orientation: {fields: [x, y, z, w], type: float64, format: quaternion}
behavior:
  stamp_encoding:
    sec: floor(request_id / 1000000000)
    nanosec: request_id % 1000000000
  finite_pose_values: true
  request_id_from_stamp: sec * 1000000000 + nanosec
  zero_stamp_fallback: bridge_sequence_counter
  orientation_mode_source: /arm/orientation_lock
  new_target_effect: supersede_previous_planning_and_trajectory
purpose: Requests arm positioning through base-station MoveIt.
```

Example message:

```yaml
header:
  stamp: {sec: 0, nanosec: 1}
  frame_id: base_link
pose:
  position: {x: 0.30, y: 0.0, z: 0.40}
  orientation: {x: 0.0, y: 0.0, z: 0.0, w: 1.0}
```

### MoveIt execution status

```yaml
topic: /arm/moveit/status
type: telemetry_interfaces/msg/ArmMoveItStatus
publisher: Base-station MoveIt bridge
subscriber: GUI Arm MoveIt provider
contract:
  request_id: {type: uint64}
  state:
    type: string
    enum: [PLANNING, EXECUTING, SUCCEEDED, CANCELED, FAILED]
  message: {type: string}
behavior:
  request_id_source: /arm/target_pose.header.stamp
  gui_correlation: request_id_must_match_active_request
  message_default: ""
purpose: Reports the progress and result of a MoveIt arm request.
```

Example message:

```yaml
request_id: 1
state: PLANNING
message: ""
```

### Arm joint telemetry

```yaml
topic: /arm/joint_states
type: sensor_msgs/msg/JointState
publisher: Rover Control
subscriber: GUI and base-station MoveIt bridge
contract:
  header:
    stamp: {sec: int32, nanosec: uint32}
  name:
    type: string[]
  position: {type: float64[], unit: rad}
  velocity: {type: float64[], unit: rad/s}
  effort: {type: float64[]}
behavior:
  stamp: current_ros_time
  joint_order: [base_joint, shoulder_joint, elbow_joint, yaw_joint, pitch_joint, roll_joint]
  position_and_velocity_length: 6
  position_and_velocity_order: name
  publish_rate_hz_default: 10
  publish_on_state_change: true
  qos: {depth: 10}
purpose: Actual Arm joint positions and velocities.
```

Example message:

```yaml
header:
  stamp: {sec: 123, nanosec: 456}
  frame_id: ""
name: [base_joint, shoulder_joint, elbow_joint, yaw_joint, pitch_joint, roll_joint]
position: [0.0, 0.25, 0.5, 0.0, 0.0, 0.0]
velocity: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
effort: []
```

### Drive mode request

```yaml
topic: /fma/drive/request
type: std_msgs/msg/String
publisher: GUI
subscriber: Rover Control
contract:
  data:
    type: string
    enum: [MANUAL, VELOCITY, MANAGED]
behavior:
  gui_values: [MANUAL, VELOCITY]
  normalization: [trim, uppercase]
  acknowledgement:
    pending_in: /fma/state.drive.pending
    confirmed_in: /fma/state.drive.confirmed
  invalid_value:
    reported_in: /fma/state.drive.rejected
purpose: Driver mode value, such as VELOCITY.
```

Example message:

```yaml
data: VELOCITY
```

### Arm mode request

```yaml
topic: /fma/arm/request
type: std_msgs/msg/String
publisher: GUI
subscriber: Rover Control
contract:
  data:
    type: string
    enum: [MANUAL, POSITION, MANAGED, STOWED]
behavior:
  gui_values: [MANUAL, POSITION]
  normalization: [trim, uppercase]
  acknowledgement:
    pending_in: /fma/state.arm.pending
    confirmed_in: /fma/state.arm.confirmed
  invalid_value:
    reported_in: /fma/state.arm.rejected
purpose: Arm mode value, such as POSITION.
```

Example message:

```yaml
data: POSITION
```

### Arm Override request

```yaml
topic: /arm/override/request
type: std_msgs/msg/String
publisher: GUI
subscriber: Rover Control
contract:
  data:
    type: string
    enum: [ENABLE, DISABLE]
behavior:
  normalization: [trim, uppercase]
  acknowledgement:
    pending_in: /fma/state.arm_override.pending
    state_in: /fma/state.arm_override.state
  effects:
    ENABLE: {arm_override: ACTIVE}
    DISABLE: {arm_override: INACTIVE}
  invalid_value: ignore
purpose: Arm Override command: ENABLE or DISABLE.
```

Example message:

```yaml
data: ENABLE
```

### Gimbal priority request

```yaml
topic: /fma/gimbal/request
type: std_msgs/msg/String
publisher: GUI
subscriber: Rover Control
contract:
  data:
    type: string
    enum: [DRIVER, "ARM OPS"]
behavior:
  normalization: [trim, uppercase]
  acknowledgement:
    pending_in: /fma/state.gimbal_priority.pending
    confirmed_in: /fma/state.gimbal_priority.confirmed
  pending_request_policy: latest_wins
  invalid_value: ignore
purpose: Temporary Gimbal priority request: DRIVER or ARM OPS.
```

Example message:

```yaml
data: "ARM OPS"
```

The mock uses mode_ack_delay_ms with a 150 ms default for these four requests.
It clears invalid Drive and Arm mode rejections after 0.5 seconds. A real rover
publishes pending and confirmed states as its Control package processes them.

### FMA state

```yaml
topic: /fma/state
type: telemetry_interfaces/msg/FmaState
publisher: Rover Control
subscriber: >-
  GUI through BaseStation ROSbridge when its FMA feed is active, otherwise
  through Rover ROSbridge
contract:
  schema: {type: string, const: dcr/fma-state/v1}
  sequence: {type: uint64}
  drive:
    type: telemetry_interfaces/msg/FmaModeState
    confirmed: {type: string, enum: [MANUAL, VELOCITY, MANAGED], absent: ""}
    pending: {type: string, enum: [MANUAL, VELOCITY, MANAGED], absent: ""}
    rejected: {type: string, absent: ""}
  arm:
    type: telemetry_interfaces/msg/FmaModeState
    confirmed: {type: string, enum: [MANUAL, POSITION, MANAGED, STOWED], absent: ""}
    pending: {type: string, enum: [MANUAL, POSITION, MANAGED, STOWED], absent: ""}
    rejected: {type: string, absent: ""}
  law: {type: string, enum: [NORMAL, ALTERNATE, DIRECT]}
  arm_override:
    type: telemetry_interfaces/msg/ArmOverrideState
    state: {type: string, enum: [INACTIVE, ACTIVE]}
    pending: {type: string, enum: [ENABLE, DISABLE], absent: ""}
  system: {type: string, enum: [GOOD, DEGRADED, FAULT, "E-STOP"]}
  gimbal_priority:
    type: telemetry_interfaces/msg/FmaModeState
    confirmed: {type: string, enum: [DRIVER, "ARM OPS"], absent: ""}
    pending: {type: string, enum: [DRIVER, "ARM OPS"], absent: ""}
    rejected: {type: string, absent: ""}
behavior:
  sequence: {min: 1, monotonic: true}
  publish: {at_startup: true, on_state_change: true, refresh_rate_hz: 1}
  qos: {reliability: reliable, durability: transient_local, depth: 1}
purpose: FMA telemetry broadcast.
```

The BaseStation ROSbridge exposes the Rover-published topic from the shared ROS
graph. It does not republish or change the FMA state.

Example initial message from the mock:

```yaml
schema: dcr/fma-state/v1
sequence: 1
drive: {confirmed: "", pending: "", rejected: ""}
arm: {confirmed: "", pending: "", rejected: ""}
law: NORMAL
arm_override: {state: INACTIVE, pending: ""}
system: GOOD
gimbal_priority: {confirmed: "", pending: "", rejected: ""}
```

The mock reports `system: GOOD` and an empty string for
`gimbal_priority.rejected` when no rejection is active.

### ECAM alerts interface

```yaml
topic: /ecam/alerts
type: telemetry_interfaces/msg/EcamAlerts
publisher: Reserved shared ECAM relay
subscriber: Reserved GUI clients
contract:
  active_codes:
    type: string[]
    semantics: complete_snapshot
    unique: true
behavior:
  updates: complete_active_code_set
purpose: Shares the current active ECAM alert codes with operator displays.
```

`EcamAlerts` reserves the message shape for the shared alert feed. The message
is built with the interfaces package, but no runtime topic is added here.

## Actions

### MoveIt planning action

```yaml
action: /move_action
type: moveit_msgs/action/MoveGroup
action_client: Base-station MoveIt bridge
action_server: MoveIt move_group
contract:
  goal:
    planning_options: {type: moveit_msgs/msg/PlanningOptions}
    request: {type: moveit_msgs/msg/MotionPlanRequest}
  result:
    error_code: {type: moveit_msgs/msg/MoveItErrorCodes}
    planned_trajectory: {type: moveit_msgs/msg/RobotTrajectory}
behavior:
  planning_options: {plan_only: true, replan: false}
  request:
    pipeline_id: ompl
    num_planning_attempts: 5
    allowed_planning_time_seconds: 5
    max_velocity_scaling_factor: 0.5
    max_acceleration_scaling_factor: 0.5
  success_error_code_val: MoveItErrorCodes.SUCCESS
purpose: Requests joint-space motion plans from MoveIt.
```

Example unlocked goal fields. The bridge fills the current start state and
leaves other message fields at their ROS defaults.

```yaml
planning_options:
  plan_only: true
  replan: false
request:
  group_name: position_arm
  pipeline_id: ompl
  num_planning_attempts: 5
  allowed_planning_time: 5.0
  max_velocity_scaling_factor: 0.5
  max_acceleration_scaling_factor: 0.5
  goal_constraints:
    - position_constraints:
        - header:
            stamp: {sec: 0, nanosec: 0}
            frame_id: base_link
          link_name: j4_pivot_link
          constraint_region:
            primitives:
              - type: 1
                dimensions: [0.01, 0.01, 0.01]
            primitive_poses:
              - position: {x: 0.30, y: 0.0, z: 0.40}
                orientation: {x: 0.0, y: 0.0, z: 0.0, w: 1.0}
          weight: 1.0
```

This action is internal to the base station's MoveIt stack.

### Arm trajectory

```yaml
action: /arm_controller/follow_joint_trajectory
type: control_msgs/action/FollowJointTrajectory
action_client: Base-station MoveIt bridge
action_server: Rover Control
contract:
  goal:
    trajectory:
      joint_names: {type: string[]}
      points:
        type: trajectory_msgs/msg/JointTrajectoryPoint[]
        fields:
          positions: {type: float64[], unit: rad}
          time_from_start: {type: duration}
  feedback:
    joint_names: {type: string[]}
    actual:
      positions: {type: float64[], unit: rad}
      velocities: {type: float64[], unit: rad/s}
  result:
    error_code: {type: int32, definition: FollowJointTrajectory.Result}
    error_string: {type: string}
behavior:
  goal:
    joint_names:
      unique: true
      unlocked: nonempty_subset_of_J1_to_J3_or_all_J1_to_J6
      locked: all_J1_to_J6
    points:
      min_length: 1
      positions: {length: joint_names.length, finite: true}
      time_from_start: {order: nondecreasing}
      final_time_from_start: {exclusive_min: 0}
    joint_limits_deg:
      base_joint: [-185, 185]
      shoulder_joint: [-5, 185]
      elbow_joint: [-5, 275]
      yaw_joint: [-95, 185]
      pitch_joint: [-5, 215]
      roll_joint: [-185, 185]
  feedback:
    joint_names: goal.trajectory.joint_names
    actual_order: joint_names
  cancel_response: ACCEPT
purpose: Timed J1-J3 partial trajectory in UNLOCKED mode or complete J1-J6 trajectory in LOCKED mode.
```

Example goal for an UNLOCKED J1-J3 trajectory:

```yaml
trajectory:
  header:
    stamp: {sec: 123, nanosec: 456}
    frame_id: ""
  joint_names: [base_joint, shoulder_joint, elbow_joint]
  points:
    - positions: [0.0, 0.2, 0.4]
      velocities: []
      accelerations: []
      effort: []
      time_from_start: {sec: 0, nanosec: 0}
    - positions: [0.1, 0.25, 0.35]
      velocities: []
      accelerations: []
      effort: []
      time_from_start: {sec: 1, nanosec: 0}
```

The Control scaffold currently rejects every trajectory goal. The mock rover
accepts goals with the joint sets and timing specified above, emits feedback
about every 0.02 seconds, and uses SUCCESSFUL, INVALID_JOINTS, or INVALID_GOAL
in its result.

## Team additions

Autonomy interfaces will be added here once their topic names and interface
details are available. Keep this catalog as the shared reference and link to it
from implementation-specific documentation.
