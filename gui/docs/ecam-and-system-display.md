# ECAM and System Display

This document defines the intended behaviour of the rover's ECAM and lower System Display (SD). The design is inspired by the Airbus glass cockpit philosophy, but the content is specific to the Deakin rover and its competition workflow.

## Display responsibilities

The vertical ECAM view has two equal sections:

```text
┌──────────────────────────────┐
│ ECAM                         │  Upper display
│ Active alerts and procedures │
├──────────────────────────────┤
│ Selected system page         │  Lower System Display
│ Live subsystem schematic     │
└──────────────────────────────┘
```

The upper `ECAM` display answers:

> What needs attention, and what can the operator do about it?

The lower `SD` answers:

> What is happening inside the selected subsystem?

The FMA in the shared Mission Control header remains the high-level operational summary. The SD should show useful subsystem detail rather than duplicate the FMA.

## Visual references

### Current Angular implementation

![Current rover ECAM and System Display](../assets/ecam.png)

### Airbus A320 references

![A320 ECAM upper and lower display locations](../assets/references/ecam1.jpg)

![A320 ECAM upper and lower displays](../assets/references/ecam2.jpg)

![A320 ECAM page-selection panel](../assets/references/ecam_pages.jpg)

## ECAM alert colours

Alert severity is defined centrally and must not be selected independently by individual UI components.

| Severity | Colour | Meaning |
|---|---|---|
| `attention` | Blue | Operator attention required |
| `warning` | Amber | Warning or degraded condition |
| `fault` | Red | Fault or condition preventing normal operation |

Active alerts are ordered by severity: faults first, then warnings, then attention messages. Alerts with the same severity are ordered by when they first appeared.

Each message has a stable alert code, for example:

```text
CONFIG_LAW_DIRECT
POWER_BATTERY_LOW
DRIVE_CONTROLLER_OFFLINE
```

The message catalogue owns the user-facing text, source subsystem, severity, and optional troubleshooting procedure.

## ECAM core

The GUI contains one application-wide `EcamAlertService` under `core/ecam/`.

Features raise and clear stable alert codes through the service. They do not choose colours, message wording, or ordering. The service deduplicates repeated codes and exposes one active-alert list to the ECAM, Pilot, Arm, and FMA interfaces.

The current core consists of:

- `ecam-alert.types.ts` — alert, severity, source, and procedure models.
- `ecam-message-catalog.ts` — the central message definitions.
- `ecam-alert.service.ts` — active alert state and ordering.

The service is currently GUI-local. It is not yet connected to rover telemetry or a shared ROS alert topic.

## Multiple operator PCs

The Angular singleton is local to one browser instance. It cannot directly share state between the Pilot, Arm, and ECAM PCs.

The intended competition architecture is:

```text
Rover Control / health nodes
  → rover health topics
                         ┐
Pilot GUI ── station status ─┤
Arm GUI ─── station status ──┤→ ECAM relay/aggregator
                              └→ /ecam/alerts

Pilot GUI  ←────────────── /ecam/alerts
Arm GUI    ←────────────── /ecam/alerts
ECAM GUI   ←────────────── /ecam/alerts
```

The relay/aggregator is a separate shared service or ROS node, not part of the ECAM GUI. It will become the shared source of truth. The GUIs will each maintain a local copy of the canonical alert state.

Rover Control owns rover faults and health. Pilot and Arm GUIs only report station-local conditions, such as a browser being unable to display a camera. They do not become the source of truth for global rover alerts.

If a station loses ROS completely, it cannot report its own failure. The relay must detect the missing station heartbeat and create a station-link alert itself.

The alert stream should:

- Publish immediately when an alert is raised, updated, or cleared.
- Publish a complete active-alert snapshot at approximately 1 Hz for recovery from dropped packets or reconnects.

A local browser failure should identify its station. For example, a Pilot browser failing to load a camera should report `PILOT FRONT CAMERA VIEW UNAVAILABLE`, not necessarily claim that the rover camera itself is broken.

## System Display pages

The current placeholder page set is:

- `DRIVE` — wheel and motor status, commanded versus actual motion, controller health, and drive faults.
- `ARM` — joint positions, soft limits, position-sensor validity, protection state, and planner status.
- `POWER` — battery voltage, current draw, power-rail health, and subsystem power where available.
- `LINK` — ROS/network health, latency, packet loss, and controller connections.
- `CAMERA` — feed availability and stream health.
- `SYSTEM` — compute health, ROS nodes/services, storage, and overall diagnostics.

`THERMAL` and `AUTONOMY` can be added when their telemetry is available and substantial enough to justify dedicated pages.

The SD page header shows the selected system name. The current page bodies are placeholders; each page will eventually use a simple structural SVG schematic with telemetry layered onto meaningful components.

```text
SVG = system topology
Telemetry = live state
ECAM = why something needs attention
```

SVGs should remain symbolic and readable on the vertical display, rather than becoming detailed CAD drawings.

## Troubleshooting procedures

An ECAM message may include an optional procedure made of ordered, remotely actionable steps. Procedures should focus on actions available from the operator stations, not physical maintenance tasks that require touching the rover during competition.

For example, `CONFIG_LAW_DIRECT` can provide steps to confirm authorisation, verify clearance, operate under visual supervision, restore `LAW NORMAL`, and stop the mission if normal protection cannot be restored.

Procedure steps have stable IDs so a future interactive checklist can track completion without changing the message catalogue. For now, procedures are displayed as indented dash bullets.

The ECAM display is informative and procedural. Rover-side Control remains authoritative for E-stop, motion limits, watchdogs, and all safety-critical inhibition.

## Future auto-page behaviour

An alert can later identify a relevant SD page through its source or an explicit page association:

```text
DRIVE_CONTROLLER_OFFLINE → DRIVE
CONFIG_ARM_NOT_STOWED    → ARM
POWER_BATTERY_LOW        → POWER
LINK_DEGRADED             → LINK
```

The SD should not constantly jump between pages when multiple alerts arrive. A new critical fault may request or temporarily select its relevant page, while the operator should retain control for ordinary alerts.
