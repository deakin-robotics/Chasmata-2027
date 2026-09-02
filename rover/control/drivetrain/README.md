# 🎛️ Drivetrain

Low-level hardware control and safety for the Deakin Rover 2027 drivetrain.

This package is the `ros2_control` hardware interface between the operator/autonomy stack and the rover's four drive motors — translating velocity commands into motor driver signals and reporting real telemetry back, safely and without direct hardware access from anywhere else in the system.

## 🚧 Status

Design complete. Implementation in progress.

## 🔧 What it does

- Implements a `ros2_control` hardware interface for the four-wheel drivetrain
- Talks to the drive motor controllers over RS485/Modbus
- Reports per-wheel telemetry (commanded speed, actual speed, fault state, communication health)
- Detects loss of command or communication and brings the drivetrain to a safe stop

## 📦 Dependencies

- ROS 2 (Jazzy) — `ros2_control`
- `libmodbus`

## 🏗️ Building

This package is part of the flat `rover/src/` workspace layout — build it the same way as the rest of the ROS 2 workspace. Standalone build instructions will be added here once the package is buildable on its own.

## 🧪 Testing

Test instructions will be added as the test suite is built out.

## 📚 Related documentation

See the [top-level README](../../../README.md) for overall repository structure, and the [autonomy](../../autonomous/README.md) and [shared](../../shared/README.md) packages for related rover-side components.
