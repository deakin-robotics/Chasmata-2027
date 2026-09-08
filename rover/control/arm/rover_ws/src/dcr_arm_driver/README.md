# DCR ARM Driver

A ROS2 Jazzy package for controlling a 6-DOF robotic arm via CAN bus. Provides motor control, status monitoring, and joint state publishing.

## Overview

The `dcr_arm_driver` package consists of two main components:

- **Motor Driver**: Low-level CAN frame generation and parsing for motor commands and telemetry
- **ARM Controller Node**: High-level ROS2 node for joint command reception, motor control, and status publishing

## Features

- **Position Control**: Send desired joint angles via ROS2 topics
- **Real-time Monitoring**: Receive motor statistics (temperature, current, speed, angle)
- **Joint Limits**: Enforces configurable min/max joint angles
- **E-stop Support**: Emergency stop functionality to halt all motors
- **Visualization**: Publishes joint states for RViz integration
- **CAN Bridge Integration**: Works with `socketcan_bridge` for hardware communication

## Installation

### Prerequisites

- ROS2 Jazzy (installed and sourced)
- `can_msgs` package
- `arm_interfaces` package (custom message definitions)
- `socketcan_bridge` (for CAN hardware interface)

### Build

```bash
# Navigate to your ROS2 workspace
cd 

# Clone or add this package
git clone <repository-url>/dcr_arm_driver

# Build the package
cd 
colcon build --packages-select dcr_arm_driver
source install/setup.bash
```

### Testing

Start the driver:
```bash
ros2 run dcr_arm_driver arm_controller_node
```

Send a command:
'''bash
ros2 topic pub /joint_commands sensor_msgs/JointState \
  '{header: {frame_id: "base"}, 
    name: ["j1", "j2", "j3", "j4", "j5", "j6"], 
    position: [0.1, 0.1, 0.1, 0, 0, 0]}'
'''

Monitor respond:
```bash
ros2 topic echo /motor_stat_1
```
