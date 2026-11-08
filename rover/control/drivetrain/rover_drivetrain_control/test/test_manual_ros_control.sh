#!/usr/bin/env bash
set -eo pipefail
source /opt/ros/jazzy/setup.bash
source /workspace/install/setup.bash
export ROS_DOMAIN_ID=176 ROS_LOCALHOST_ONLY=1
test_dir=/workspace/src/rover_drivetrain_control/test
config=/workspace/src/rover_drivetrain_control/config/drivetrain_controllers.yaml
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT
ros2 run robot_state_publisher robot_state_publisher --ros-args -r __ns:=/drivetrain \
  -p "robot_description:=$(cat "$test_dir/manual_simulated.urdf")" & pids+=($!)
ros2 run controller_manager ros2_control_node --ros-args -r __ns:=/drivetrain --params-file "$config" & pids+=($!)
ros2 run rover_drivetrain_control direct_drive_relay & pids+=($!)
timeout 45 ros2 run controller_manager spawner wheel_velocity_controller \
  --controller-manager /drivetrain/controller_manager --param-file "$config" --inactive
ros2 run mock_rover mock_rover --ros-args -p drive_backend:=real \
  -p drive_max_wheel_speed:=1.6755160819145563 & pids+=($!)
timeout 35 python3 "$test_dir/test_manual_ros_control.py"
