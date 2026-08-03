# Operator Layouts

The operator interface is **inspired by Airbus ECAM system displays**. A symbolic rover remains central while live camera feeds and telemetry are arranged according to the active operator's task.

The `MissionControl` shell renders the selected operator dashboard; it does not itself own the camera feeds or rover schematic.

## Pilot view

```text
┌───────────────────────────────────────────────┬──────────────┐
│ Front camera                                  │ Bird view    │
│                                               │ placeholder  │
├───────────────┬───────────────┬───────────────┼──────────────┤
│ Left camera   │ Rover         │ Right camera  │ Pilot        │
│               │ schematic     │               │ control      │
├───────────────┴───────────────┴───────────────┤ panel        │
│ Rear camera                                   │              │
└───────────────────────────────────────────────┴──────────────┘
```

The front camera has the highest visual priority. Left, right, and rear camera panels retain the rover-relative cockpit arrangement around the shared rover schematic. The gamepad schematic floats over the camera area rather than occupying the sidebar.

The right sidebar places Bird View above the Pilot control panel. The control panel uses the compact Pilot-style Drive tab and owns the ROS link, gamepad status, and Master Drive switch.

## Arm operator view

```text
┌──────────────────┬───────────────────────┬──────────────────┐
│ Front rover cam  │ Arm camera            │ Arm control panel │
├──────────────────┤                       │                  │
│ Rover schematic  ├───────────────────────┼──────────────────┤
├──────────────────┤ Arm schematic         │ Clamp schematic   │
│ Rear rover cam   │                       │ placeholder      │
└──────────────────┴───────────────────────┴──────────────────┘
```

The arm camera and rover-awareness column are both first-class visual inputs. The rover-awareness column provides front and rear rover context around the shared rover schematic. The Arm control panel groups gamepad status, ROS link state, and the Master Drive control in the right column.

The Arm schematic is currently a placeholder for future joint, end-effector, limit, and MoveIt-derived state. The clamp schematic is also a placeholder until the end-effector telemetry and command contract exists.
