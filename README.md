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

## 🎛️ Control

## 🤖 Autonomy

## 📚 Project documentation

- [GUI documentation](gui/README.md)
- [Control documentation](rover/control/README.md)
- [Autonomy documentation](rover/autonomous/README.md)

## 🚧 Status

The project is under active development. GUI, Control, and Autonomy interfaces are being developed in parallel, with rover integration and physical validation still required.
