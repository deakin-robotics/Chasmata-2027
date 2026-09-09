# Control Mode Responsibilities

This document explains the different kinds of control mode in the GUI. The
names are similar, but they answer different questions.

## The four related services

| File | Responsibility |
|---|---|
| `src/app/core/control/control-mode.ts` | Global control authority: who currently owns control — `none`, `driver`, or `arm`. Command publishers use this to decide whether commands are allowed. |
| `src/app/core/control/control-mode-coordinator.ts` | Coordinates mode selections, local mode services, and ROS connection state. It sends mode requests to ROS; rover telemetry remains authoritative for FMA state. |
| `src/app/core/control/drive/drive-control-mode.ts` | Driver control interpretation: `MANUAL` or `VELOCITY`. |
| `src/app/core/control/arm/arm-control-mode.ts` | Arm control interpretation: `MANUAL` or `POSITION`. |

In short:

- `ControlModeService` answers: **Who is allowed to control?**
- `DriverControlModeService` answers: **How should Driver input control the rover?**
- `ArmControlModeService` answers: **How should Arm Operator input control the arm?**
- `ControlModeCoordinator` answers: **How do selections and ROS connection become mode requests?**

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

```mermaid
flowchart LR
    driver[Driver mode selector] --> coordinator[ControlModeCoordinator]
    arm[Arm mode selector] --> coordinator
    coordinator --> local[Local mode service]
    coordinator --> connection{ROS connected?}
    connection -->|Yes| request[ROS 2 mode request]
    request --> rover[Rover Control]
    connection -->|No| disconnected[Local selection only]
    rover --> telemetry[FMA telemetry<br/>pending / confirmed / rejected]
```

When the coordinator observes a ROS connection:

1. It sends the current Driver and Arm local modes as mode requests.
2. It does this once for that connection transition.
3. It does not locally author the authoritative FMA state.

The rover publishes pending, confirmed, and rejected mode state through its
FMA telemetry. That FMA telemetry is broadcast to every GUI instance. When the
connection is lost, each browser hides or clears its displayed rover state
without changing the local Driver or Arm defaults/selections. When the
connection returns, those preserved local selections are requested again.

## FMA state ownership

`FmaStateService` remains the shared store for the main FMA columns:

```mermaid
flowchart LR
    driver[Driver mode selector] --> coordinator[ControlModeCoordinator]
    arm[Arm mode selector] --> coordinator
    coordinator --> request[ROS 2 mode request]
    request --> rover[Rover Control<br/>authoritative FMA state]
    rover --> broadcast[FMA telemetry broadcast<br/>pending / confirmed / rejected]
    broadcast --> browser1[FmaStateService<br/>Driver GUI]
    broadcast --> browser2[FmaStateService<br/>Arm GUI]
    broadcast --> browser3[FmaStateService<br/>ECAM GUI]
    browser1 --> renderer1[FMA renderer]
    browser2 --> renderer2[FMA renderer]
    browser3 --> renderer3[FMA renderer]
```

`FmaStateService` is a shared store only within one browser instance. The rover
FMA telemetry broadcast is what keeps the three browser instances synchronized.
The FMA component only renders its local store; it does not select modes,
create requests, reset modes, or coordinate the ROS connection.

For a mode request, the rover broadcasts the requested value so each FMA
displays it in blue while waiting for acknowledgement. Rover-confirmed state
is displayed in green. Rejected requests are cleared from each local
`FmaStateService` without becoming confirmed state. ECAM alert codes follow a
separate `ecam/alerts` path. See [`fma.md`](./fma.md) for the complete
annunciator definition.

## Naming reminder

When reading or changing code, first ask which question the code is answering:

| Question | Use |
|---|---|
| Who owns control authority? | `ControlModeService` |
| Which Driver mode is selected? | `DriverControlModeService` |
| Which Arm mode is selected? | `ArmControlModeService` |
| How are selections synchronized with ROS and FMA? | `ControlModeCoordinator` |
