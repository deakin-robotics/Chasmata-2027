# GUI Telemetry Requirements

This document defines the telemetry required by the GUI/base station for the
Functional Mode Annunciator (FMA), Electronic Centralized Advisory Monitor
(ECAM), and System Display (SD) pages. It
defines what the GUI needs to receive; Control owns the rover-side production,
validation, and safety enforcement of that telemetry.

## Delivery rules

Telemetry is divided into immediate state-change updates, 10 Hz dynamic
telemetry, 1 Hz operational telemetry, and a complete 1 Hz recovery snapshot.

Every telemetry value must include validity or staleness information. When ROS
is connected, the GUI must show unavailable or unknown state when data is stale
or missing rather than continue to present old data as current. When ROS is
disconnected entirely, the FMA and dependent displays use their overall
unavailable state instead of rendering individual telemetry values.

### Immediate state-change updates

The rover must publish the following immediately whenever they change:

- E-stop and watchdog state.
- DRIVE, ARM, LAW, and SYSTEM FMA state; Gimbal owner/priority and LINK state.
- Pending, confirmed, and rejected DRIVE/ARM mode request state.
- Pending and confirmed LAW override state.
- Motor, drivetrain, and arm fault state.
- Safety-inhibit, arm-protection, and joint-limit state.
- Controller connection state.
- ROS/network connection, degradation, and loss state.
- T/O CONFIG result and individual failed or unknown conditions.
- Gimbal owner/priority state, including confirmed owner, pending takeover,
  unknown, or stale state.
- Camera availability changes.
- ECAM active alert state.

### 10 Hz dynamic telemetry

The rover must publish the following at 10 Hz:

- Commanded and actual wheel velocity.
- Wheel position and odometry.
- Arm joint position and velocity.
- Arm current/torque where available.
- Gimbal position and movement/control state.
- Network latency and link-quality measurements where available.

### 1 Hz operational and diagnostic telemetry

The rover must publish the following at 1 Hz:

- Battery voltage, current, and total power.
- Power-rail or subsystem health where available.
- Motor and arm temperature.
- Motor-driver state.
- CAN and RS485 communication health.
- Camera and stream health.
- ROS node and service health.
- CPU, memory, storage, and system temperature where available.
- LED state.

### Complete 1 Hz recovery snapshot

The rover must also publish a complete current-state snapshot at least once per
second. It includes the latest values from every telemetry category, active
faults and alerts, FMA states, safety states, link state, T/O CONFIG status,
and Gimbal ownership. This allows a GUI instance to recover after reconnecting
or missing an update. The snapshot includes both confirmed FMA values and any
pending DRIVE, ARM, LAW, or Gimbal priority request state.

## FMA and ECAM requirements

The FMA requires confirmed DRIVE, ARM, LAW, GIMBAL owner/priority, and SYSTEM
state. Link health remains available as general telemetry and for the System
Display. For DRIVE and ARM mode changes, the rover must also publish the
current pending request or rejection result. LAW reports only its authoritative
`NORMAL`, `ALTERNATE`, or `DIRECT` state. Arm Override is reported
independently in the same `/fma/state` bundle with its confirmed state and any
pending `ENABLE` or `DISABLE` command.

A pending Override enable is displayed in blue by every GUI instance; it is not
displayed as active until the rover reports `arm_override.state = ACTIVE`. A
pending disable leaves the confirmed red `OVERRIDE` visible until the rover
reports `INACTIVE`. `DIRECT` with an inactive Override is valid when both
protection layers are unavailable for another reason. The GUI sends `ENABLE` or
`DISABLE` on `/arm/override/request`; LAW does not interpret those commands.

ECAM uses complete active alert-code snapshots. The rover sends the full current
set of stable active ECAM codes immediately whenever that set changes and in the
1 Hz recovery snapshot. A code absent from a newer complete snapshot is cleared
by the GUI. The GUI message catalogue maps each code to its text, severity,
source, and optional procedure.

See the [ECAM Code Dictionary](ecam-code-dictionary.md) for the available code
identifiers, meanings, severities, and display text.

If ECAM alert telemetry is stale or unavailable, the GUI must show that alert
state is unavailable rather than assuming that all alerts are cleared.

## T/O CONFIG contract

`T/O CONFIG` is an operator-requested check. The GUI sends the request first;
the rover then evaluates the current configuration and returns the authoritative
result.

The rover response contains:

```text
result: NORMAL | FAILED | UNKNOWN
ecam_codes: [ ... ]
```

The `result` is the overall result of the check. The `ecam_codes` array contains
the stable ECAM codes for the individual failed conditions that the rover found.
The GUI resolves those codes through its message catalogue and displays their
text, severity, and any associated procedure.

`NORMAL` means that the rover confirmed all applicable checks at the time of the
request. `FAILED` means that one or more checks failed and the returned codes
identify the causes. `UNKNOWN` means that the rover could not determine a valid
result; the GUI must not present this as normal.

The rover publishes the response immediately and includes the latest result and
code array in the complete 1 Hz recovery snapshot. A code absent from a newer
complete array is cleared from the GUI's active T/O CONFIG conditions.

The GUI owns request timeout handling. If no response arrives within the GUI's
request window, the GUI marks the result as unavailable or timed out locally and
shows an amber T/O CONFIG state with an appropriate local ECAM message. This is
not a rover result and is not included in the rover's `result` enumeration.

## System Display requirements

| SD page | Required telemetry |
|---|---|
| `DRIVE` | Commanded/actual wheel velocity, odometry, motor current/temperature, motor-driver state, faults, and RS485 health. |
| `ARM` | Joint position/velocity, current/torque where available, temperature, faults, CAN health, sensor validity, and planner state. Control mode, joint limits, and LAW/protection annunciation remain in the FMA. |
| `POWER` | Battery voltage/current, total power, and power-rail/subsystem health where available. |
| `LINK` | Network latency, packet loss/link quality where available, ROS node/service health, controller connection, and watchdog state. |
| `CAMERA` | Front, Arm, and Gimbal camera availability; stream health; reconnect state; latency where available; and Gimbal position/control state. Authoritative Gimbal ownership remains in the FMA. |
| `SYSTEM` | ROS node/service health, CPU/memory/storage/system temperature where available, LED state, and overall diagnostics. E-stop state remains in FMA/ECAM. |

## Gimbal telemetry

Both Driver and Arm Operator stations can view and request control of the shared
Gimbal camera. The rover owns the authoritative owner state and validates
station-identified movement commands.

Gimbal priority must publish immediately when a request becomes pending, when
the confirmed owner changes, and in the 1 Hz recovery snapshot. The telemetry
must include both `confirmed` and `pending` owner values. If ROS is connected
but owner telemetry is null, explicitly unknown, or stale, the FMA must display
`PRIORITY UNK` rather than the last known owner. If ROS is
disconnected entirely, the FMA hides the priority value and shows its overall
unavailable indicator instead.

## Interface ownership

Control and GUI jointly define the semantic GUI-to-ROS contract, including the
telemetry models, units, validity/staleness rules, and update behaviour. Control
owns hardware-specific CAN, RS485, camera-server, and safety implementation.
