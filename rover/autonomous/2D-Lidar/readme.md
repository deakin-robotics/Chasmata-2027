# Chasmata Autonomous Stack

ROS 2 Humble autonomous navigation — 2D LiDAR SLAM + EKF localisation + simulation.

## Prerequisites

```bash
sudo apt install \
  ros-humble-slam-toolbox \
  ros-humble-robot-localization \
  ros-humble-interactive-markers \
  ros-humble-rviz2
```

## Build

```bash
# From repo root:
cd rover/autonomous
colcon build --symlink-install
source install/setup.bash
```

## Run — Simulation

```bash
ros2 launch chasmata_bringup simulation_bringup.launch.py
```

Opens RViz with robot model, LiDAR scan, SLAM map, and 2 draggable obstacle
boxes.  Drag a box onto the rover's path to trigger real-time avoidance.

## Run — Hardware

```bash
ros2 launch chasmata_bringup hardware_bringup.launch.py
```

Expects `/scan` (RPLIDAR A3), `/imu/data`, and `/wheel_odom` from hardware drivers.

## Package layout

```
autonomous/
└── src/
    ├── chasmata_description/     URDF/xacro robot model + RViz preset
    ├── chasmata_bringup/         Top-level launch files (sim + hardware)
    ├── chasmata_fake_sensors/    Kinematic sim with 3-zone obstacle avoidance
    ├── chasmata_localization/    EKF: wheel odom + IMU → odom frame
    └── chasmata_mapping/         SLAM Toolbox — online async 2D mapping
```

## Key config files

| File | Controls |
|:--|:--|
| `chasmata_localization/config/ekf.yaml` | EKF sensor fusion weights |
| `chasmata_mapping/config/mapper_params_online_async.yaml` | SLAM range, resolution |
| `chasmata_description/rviz/urdf.rviz` | RViz layout preset |

## TF tree

```
map  (SLAM Toolbox)
 └── odom  (EKF)
      └── base_link
           ├── lidar_link
           └── imu_link
```

## Obstacle avoidance (simulation)

3-zone state machine inside `fake_sensors.py`:

| Zone | Trigger | Behaviour |
|:--|:--|:--|
| Warn | < 1.30 m | Slow down, adjust heading |
| Danger | < 0.65 m | AVOID state — commit to best clear gap |
| Emergency | < 0.38 m | Hard stop → REVERSE |
| Stuck | < 0.15 m in 2 s | Auto-trigger REVERSE |
