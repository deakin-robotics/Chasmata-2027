# Operator Layouts

The operator interface is **inspired by Airbus ECAM system displays**. A symbolic rover remains central while live camera feeds and telemetry are arranged according to the active operator's task.

The `MissionControl` shell renders the selected operator dashboard; it does not itself own the camera feeds or rover schematic.

## Pilot view

```text
┌──────────────────────────────────────────────────────────────┐
│                       FRONT CAMERA                           │
│                       largest feed                           │
├───────────────────┬─────────────────────┬────────────────────┤
│ Left / side camera│                     │ Right / side camera│
│                   │   ROVER SCHEMATIC   │                    │
│                   │ heading, health,    │                    │
│                   │ wheel state, alerts │                    │
├───────────────────┴─────────────────────┴────────────────────┤
│                      REAR CAMERA                             │
└──────────────────────────────────────────────────────────────┘
```

The front camera has the highest visual priority. The schematic provides system awareness and must not imply that commanded movement is confirmed movement.

## Arm operator view

```text
┌──────────────────┬───────────────────────────────────────────┐
│ Front / context  │                 ARM CAMERA                │
│ camera           │                 largest feed              │
├──────────────────┤                                           │
│ Rover schematic  │                                           │
│ arm pose/status  │                                           │
├──────────────────┼───────────────────────────────────────────┤
│ Rear / side      │ Motor telemetry, end effector, limits     │
└──────────────────┴───────────────────────────────────────────┘
```

The arm camera has the highest visual priority. The same rover schematic presents arm state and joint-limit information.
