# 🚙 Deakin Rover 2027

Software and operator-interface development for the Deakin Competitive Robotics Club's 2027 rover.

The project is under active development. The current focus is a browser-based Mission Control interface alongside rover-side software and documentation.

## 🗂️ Repository layout

```text
gui/    Browser-based operator Mission Control interface
rover/  Rover-side software
  control/     Low-level hardware control and safety
  autonomous/  Navigation, perception, and task autonomy
  shared/      Shared rover-side interfaces and utilities
docs/   Project-wide documentation and competition references
```

## 🖥️ Operator GUI

The GUI is the browser-based Mission Control interface for rover operators. It provides a shared shell with dedicated Pilot, Arm, and ECAM views, and is being developed alongside the rover-side control and autonomy software.

For GUI installation, development commands, architecture, and ROS integration details, see the [GUI README](gui/README.md).

## 📚 Documentation

- [GUI operator layouts](gui/docs/operator-layouts.md)
- [GUI colour palette](gui/docs/color-palette.md)
- [Rover FMA mode definitions](gui/docs/fma.md)

## 🚧 Status

The Angular GUI is being developed as a structured replacement for the previous operator interface. Rover integration and physical validation remain required before it is used for rover operations.
