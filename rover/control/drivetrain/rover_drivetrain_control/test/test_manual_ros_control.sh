#!/usr/bin/env bash
set -eo pipefail
source /opt/ros/jazzy/setup.bash
source /workspace/install/setup.bash
export ROS_DOMAIN_ID=176 ROS_LOCALHOST_ONLY=1
test_dir=/workspace/src/rover_drivetrain_control/test
config=$(mktemp)
export TEST_CONTROLLERS_CONFIG="$config"
python3 - <<'PY'
import os
import yaml
with open('/workspace/src/rover_drivetrain_control/config/drivetrain_controllers.yaml') as stream:
    config = yaml.safe_load(stream)
params = config['/drivetrain/diff_drive_controller']['ros__parameters']
params.update(wheel_radius=0.1, wheel_separation=0.5)
with open(os.environ['TEST_CONTROLLERS_CONFIG'], 'w') as stream:
    yaml.safe_dump(config, stream)
PY
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -f "$config"
}
trap cleanup EXIT
setsid ros2 run robot_state_publisher robot_state_publisher --ros-args -r __ns:=/drivetrain \
  -p "robot_description:=$(cat "$test_dir/manual_simulated.urdf")" & pids+=($!)
setsid ros2 run controller_manager ros2_control_node --ros-args -r __ns:=/drivetrain --params-file "$config" & pids+=($!)
setsid ros2 run rover_drivetrain_control direct_drive_relay & pids+=($!)
timeout 45 ros2 run controller_manager spawner wheel_velocity_controller \
  --controller-manager /drivetrain/controller_manager --param-file "$config" --inactive
timeout 45 ros2 run controller_manager spawner diff_drive_controller \
  --controller-manager /drivetrain/controller_manager --param-file "$config" --inactive
timeout 45 ros2 run controller_manager spawner joint_state_broadcaster \
  --controller-manager /drivetrain/controller_manager --param-file "$config"
setsid ros2 run rover rover --ros-args -p drive_backend:=real \
  -p drive_max_wheel_speed:=1.6755160819145563 \
  -p drive_wheel_radius:=0.1 -p drive_wheel_separation:=0.5 & pids+=($!)
timeout 35 python3 "$test_dir/test_manual_ros_control.py"
