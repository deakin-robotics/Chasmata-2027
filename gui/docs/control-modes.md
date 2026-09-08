# Control Mode Responsibilities

This document explains the different kinds of control mode in the GUI. The
names are similar, but they answer different questions.

## The four related services

| File | Responsibility |
|---|---|
| `src/app/core/control/control-mode.ts` | Global control authority: who currently owns control — `none`, `driver`, or `arm`. Command publishers use this to decide whether commands are allowed. |
| `src/app/core/control/control-mode-coordinator.ts` | Coordinates mode selections, local mode services, ROS connection state, and pending FMA requests. It is also the future insertion point for publishing mode commands to ROS. |
| `src/app/core/control/drive/drive-control-mode.ts` | Driver control interpretation: `MANUAL` or `VELOCITY`. |
| `src/app/core/control/arm/arm-control-mode.ts` | Arm control interpretation: `MANUAL` or `POSITION`. |

In short:

- `ControlModeService` answers: **Who is allowed to control?**
- `DriverControlModeService` answers: **How should Driver input control the rover?**
- `ArmControlModeService` answers: **How should Arm Operator input control the arm?**
- `ControlModeCoordinator` answers: **How do selections, ROS connection, and FMA state work together?**

## Control authority versus control interpretation

These are separate concepts. For example, the Driver can own control
authority while the Driver's selected interpretation mode is `VELOCITY`:

```text
Control authority:       DRIVER owns control
Driver interpretation:   VELOCITY
Arm interpretation:      POSITION
```

The authority service does not choose between `MANUAL`, `VELOCITY`, or
`POSITION`. Those choices belong to the subsystem-specific mode services.

## Current defaults

| Subsystem | Local default | Meaning |
|---|---|---|
| Driver | `VELOCITY` | Driver input is interpreted as assisted velocity control. |
| Arm Operator | `POSITION` | Arm Operator input is interpreted as an end-effector position target for IK. |

The defaults are local GUI selections. They are not confirmed rover states.

## Selection and connection flow

The mode pages call the coordinator. They do not write to the FMA state store
directly.

```text
Driver mode selector ─┐
                      ├─> ControlModeCoordinator ──> local mode service
Arm mode selector ────┘                                  │
                                                         ├─ ROS connected:
                                                         │  pending FMA request
                                                         │  future ROS command
                                                         └─ ROS disconnected:
                                                            local selection only
```

When the coordinator observes a ROS connection:

1. It records the current Driver and Arm local modes as pending FMA requests.
2. It does this once for that connection transition.
3. Future ROS command publishing will be added at this same boundary.

When the connection is lost, it clears the confirmed and pending `DRIVE` and
`ARM` FMA states. It does not change the local Driver or Arm defaults/selections.
When the connection returns, those preserved local selections are requested
again.

## FMA state ownership

`FmaStateService` remains the shared store for the main FMA columns:

```text
Rover telemetry ──> FmaStateService ──> FMA renderer and other consumers
                         ^
                         │
ControlModeCoordinator ──┘  pending local mode requests
```

The FMA component only renders the state. It does not select modes, create
requests, reset modes, or coordinate the ROS connection.

For a mode request, the FMA displays the requested value in blue while waiting
for rover acknowledgement. Rover-confirmed state is displayed in green.
Rejected requests are cleared through `FmaStateService` without becoming
confirmed state. See [`fma.md`](./fma.md) for the complete annunciator
definition.

## Gimbal priority is separate

Gimbal priority is not another control mode and is not a sixth FMA column. It
is a secondary indicator managed by `GimbalPriorityService` and rendered below
the LAW state:

```text
GIM PRI UNK       no confirmed owner
<- DRIVER         Driver owns Gimbal priority
ARM OPS ->        Arm Operator owns Gimbal priority
```

## Naming reminder

When reading or changing code, first ask which question the code is answering:

| Question | Use |
|---|---|
| Who owns control authority? | `ControlModeService` |
| Which Driver mode is selected? | `DriverControlModeService` |
| Which Arm mode is selected? | `ArmControlModeService` |
| How are selections synchronized with ROS and FMA? | `ControlModeCoordinator` |
