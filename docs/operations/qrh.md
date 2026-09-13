# Rover Quick Reference Handbook

> **v0.1 — GUI-only basestation/mock-rover procedures.** This handbook uses
> only GUI-provided camera, telemetry, control, and restart functions. Physical
> hardware behavior and physical E-stop procedure are not yet validated.

Print intent: compact A5-or-smaller cards, later organised with section tabs.
Use the [Operations SOP](sop.md) for context and operating rationale.

Use onboard camera feeds and live telemetry for all operation and recovery. If
they cannot support a controlled recovery, abort the task or use GUI E-stop;
field-side assistance is only considered after the run is ended or permitted.

## CONFIG / PREFLIGHT

Future content.

## DRIVE

Future content.

## ARM

### ARM — NORMAL SETUP

**Condition:** Preparing to operate the arm.

```text
ROS LINK ........................... CONNECTED
ARM TELEMETRY ...................... LIVE
ONBOARD CAMERA ...................... USABLE / CLEAR VIEW
ARM MODE ........................... POSITION or MANUAL AS REQUIRED
LAW ................................ NORMAL
ARM MOVEMENT ....................... MONITOR CAMERA + TELEMETRY
```

### ARM — MOVEIT / POSITION FAILURE

**Condition:** Position target is rejected, unreachable, or does not produce
the required motion.

```text
CONTROLS ............................ RELEASE
ARM MODE ............................ MANUAL
ONBOARD CAMERA / TELEMETRY .......... CONFIRM LIVE
ARM RESPONSE ........................ VERIFY WITH SMALL INPUT
LAW ................................. NORMAL
POSITION MODE ....................... RETRY ONLY AFTER CAUSE IS UNDERSTOOD
```

### ARM — TELEMETRY INVALID / STALE

**Condition:** Arm telemetry is missing, invalid, or stale.

```text
CONTROLS ............................ RELEASE
POSITION MODE ....................... DO NOT CONTINUE
ONBOARD CAMERA ...................... CONFIRM ARM STOPPED
ROS LINK ............................ CHECK / RESTORE
TELEMETRY ........................... VERIFY LIVE BEFORE RE-ENGAGEMENT
```

### ARM — UNEXPECTED MOTION

**Condition:** Arm moves contrary to the intended command or its state is not
understood.

```text
CONTROLS ............................ RELEASE
GUI E-STOP .......................... PRESS
ROVER STATE ......................... HALTED
GUI ACTION .......................... RESTART ROVER
ROS LINK / CAMERA / TELEMETRY ....... RECONNECT AND VERIFY
OPERATIONS .......................... RETURN TO PREFLIGHT
```

### ARM — FALSE SOFT-LIMIT / DIRECT RECOVERY

**Condition:** A known false soft-limit prevents necessary Manual recovery.

```text
ARM MODE ............................ MANUAL
ONBOARD CAMERA ...................... CONFIRM CLEAR VIEW
TELEMETRY ........................... CONFIRM LIVE
ARM OVERRIDE ........................ SELECT
LAW ................................ OVERRIDE PENDING
LAW ................................ DIRECT CONFIRMED
CONTROLS ............................ SMALL, DELIBERATE INPUTS
ARM OVERRIDE ........................ RELEASE WHEN RECOVERY COMPLETE
LAW ................................ NORMAL / ALTERNATE CONFIRMED
```

`POSITION + DIRECT` is an exception only for a known false-protection
condition. It is not a first response to a Position, telemetry, or unexpected
motion problem. `DIRECT` is a LAW state, not an operator selection.

### ARM — DIRECT REPORTED

**Condition:** The rover reports `DIRECT` because both protection layers are
unavailable.

```text
CONTROLS ............................ RELEASE
ONBOARD CAMERA / TELEMETRY .......... CONFIRM LIVE
ARM MODE ............................ MANUAL
CONTROLS ............................ SMALL, DELIBERATE INPUTS
LAW ................................ MONITOR FOR NORMAL / ALTERNATE
GUI E-STOP .......................... PRESS IF UNSAFE
```

### ARM — RETURN TO NORMAL

**Condition:** DIRECT recovery is complete, or normal Position operation is to
resume.

```text
ARM OVERRIDE ........................ RELEASE IF SELECTED
ARM MODE ............................ MANUAL
ONBOARD CAMERA / TELEMETRY .......... LIVE AND UNDERSTOOD
ARM RESPONSE ........................ VERIFY WITH SMALL INPUT
LAW ................................ NORMAL / ALTERNATE CONFIRMED
ARM MODE ............................ POSITION AS REQUIRED
ARM MOVEMENT ....................... MONITOR CAMERA + TELEMETRY
```

## CAMERA / GIMBAL

Future content.

## SYSTEM / LINK

### SYSTEM / LINK — GUI E-STOP / RESTART

**Condition:** Unexpected motion or an unrecoverable rover state.

```text
CONTROLS ............................ RELEASE
GUI E-STOP .......................... PRESS
ROVER STATE ......................... HALTED
GUI ACTION .......................... RESTART ROVER
ROS LINK / CAMERA / TELEMETRY ....... RECONNECT AND VERIFY
OPERATIONS .......................... RETURN TO PREFLIGHT
```

## POWER

Future content.

## RECOVERY / EMERGENCY

Future content.

```text
PHYSICAL E-STOP ..................... [PROCEDURE PENDING HARDWARE VALIDATION]
```
