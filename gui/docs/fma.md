# Rover FMA Mode Definitions

This document defines the five Flight Mode Annunciator (FMA) columns used in the rover GUI:

**DRIVE | ARM | LAW | SYSTEM | LINK**

The FMA should display the rover's **confirmed active state**, not merely a requested state.

---

## FMA Interaction Behaviour

The FMA displays the **confirmed rover state**, not simply what the operator requested.

### Command pending
When an operator selects a mode from the GUI, the requested mode is shown in **blue** while the command is waiting for acknowledgement from the rover.

### Command confirmed
Once the rover receives the command, changes state, and returns an acknowledgement handshake, the mode changes to **green**.

### Command rejected / no acknowledgement
If the rover rejects the command or acknowledgement is not received, the requested mode must not be shown as active. The FMA should continue displaying the last confirmed state or indicate the failure through the appropriate system warning.

Example:

`MANUAL` → operator selects `VELOCITY`

`VELOCITY` **blue** → command sent / awaiting acknowledgement

`VELOCITY` **green** → rover acknowledged and confirmed the mode

---

## 🚙 DRIVE

This column answers:

> **How is the rover currently being driven?**

### `MANUAL`

Raw skid-steer control.

The Pilot directly controls the **left and right wheel groups independently** using the gamepad. Used as a fallback when the higher-level drive controller has problems.

### `VELOCITY`

Normal assisted driving mode.

The Pilot uses a **single joystick** for forward/backward movement and left/right rotation. These become linear and angular velocity commands through `cmd_vel`, and the drivetrain controller calculates the required left/right wheel speeds.

### `MANAGED •`

Autonomous control owns the drivetrain.

Nav2 or another autonomy component generates the movement commands instead of the Pilot.

### No displayed mode

If there is no valid connection or confirmed drive mode, **display nothing**.

---

## 🦾 ARM

This column answers:

> **How is the robotic arm currently being controlled or configured?**

### `MANUAL`

Direct joint control.

Arm Ops uses the gamepad to command **individual joints directly**. Used when IK or motion planning cannot produce a sensible solution.

### `POSITION`

Solver-assisted control.

Arm Ops specifies a desired **end-effector position/pose**, and MoveIt 2 handles the joint solution and motion planning.

### `MANAGED •`

Higher-level automation owns the arm.

An autonomous routine or task sequence commands arm motion without continuous manual input from Arm Ops.

### `STOWED`

The arm is parked in its designated travel configuration.

It stays folded close to the rover when not in use, helping maintain a good **center of gravity**.

---

## 🛡️ LAW

This refers specifically to **arm protection**.

### `NORMAL`

Full protection available.

Both the **GUI-side protection**, which uses rover telemetry to monitor arm position, and the **rover-side low-level soft end-stop protection** are functioning normally.

### `ALTERNATE`

GUI-side protection is unavailable because the required rover telemetry or communication has been lost.

The **rover-side low-level soft end-stop protection remains active**, so the arm can still operate with reduced protection.

### `DIRECT`

Protection override deliberately selected.

Normal soft-limit protection is bypassed to give Arm Ops direct authority when required. The physical/system safety mechanisms, including E-STOP, still remain available.

If Arm Ops selects the override:

`LAW: NORMAL → DIRECT`

This annunciation makes it clear that the arm is operating without its normal protection layer.

---

## 🖥️ SYSTEM

This column answers:

> **Is the underlying rover system okay?**

### `READY`

Required ROS/control nodes, communications, and controllers are healthy.

### `DEGRADED`

Something has failed or disconnected, but the rover remains operational. For example, a camera may be unavailable while drive and control remain functional.

### `FAULT`

A significant failure prevents normal operation or requires operator attention.

### `E-STOP`

Emergency stop is active. Actuation is disabled and a deliberate reset/re-arm action is required before operation can resume.

---

## 📡 LINK

This column answers:

> **How healthy is the communication link between the rover and base station?**

### `GOOD`
Communication is healthy. Commands, telemetry, and other required data are being transmitted normally.

### `DEGRADED`
The link is still usable, but communication quality has deteriorated due to latency, packet loss, reduced bandwidth, or similar issues.

### `LOST`
Communication with the rover has been lost.

### No displayed mode
If link status is not available or has not yet been established, **display nothing**.

---

## FMA Summary

| Column | Purpose | Modes |
|---|---|---|
| **DRIVE** | Current drivetrain control method | `MANUAL`, `VELOCITY`, `MANAGED •` |
| **ARM** | Current arm control/configuration | `MANUAL`, `POSITION`, `MANAGED •`, `STOWED` |
| **LAW** | Arm protection level | `NORMAL`, `ALTERNATE`, `DIRECT` |
| **SYSTEM** | Overall rover/control-stack health | `READY`, `DEGRADED`, `FAULT`, `E-STOP` |
| **LINK** | Rover/base-station communication health | `GOOD`, `DEGRADED`, `LOST` |
