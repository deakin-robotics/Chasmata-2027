#!/usr/bin/env bash
set -euo pipefail

DRIVE_MAX_WHEEL_SPEED=$(python3 - <<'PY'
import math
import os
import stat
import sys
import yaml

try:
    with open('/etc/rover/drivetrain/drivetrain_hardware.yaml', encoding='utf-8') as config_file:
        config = yaml.safe_load(config_file)
    if not isinstance(config, dict) or not isinstance(config.get('serial_device'), str):
        raise ValueError('serial_device must be set in drivetrain_hardware.yaml')
    device = os.path.realpath(config['serial_device'])
    if not device.startswith('/dev/'):
        raise ValueError('serial_device must resolve to a device under /dev')
    info = os.stat(device)
    if not stat.S_ISCHR(info.st_mode) or os.major(info.st_rdev) not in (166, 188):
        raise ValueError('serial_device must be a USB serial device (ttyACM or ttyUSB)')
    ratio = float(config['gear_ratio'])
    limit = float(config['motor_rpm_limit'])
    if not math.isfinite(ratio) or ratio <= 0 or not math.isfinite(limit) or limit < 800:
        raise ValueError('gear_ratio must be positive and motor_rpm_limit must be at least 800 RPM')
    print(800 * 2 * math.pi / (60 * ratio))
except (OSError, KeyError, TypeError, ValueError, yaml.YAMLError) as error:
    print(f'Invalid drivetrain configuration: {error}', file=sys.stderr)
    sys.exit(1)
PY
)
export DRIVE_MAX_WHEEL_SPEED

set +u
source /opt/ros/jazzy/setup.bash
source /workspace/install/setup.bash
set -u
ros2 launch rover_drivetrain_control drivetrain.launch.py hardware_config:=/etc/rover/drivetrain/drivetrain_hardware.yaml &
drivetrain_pid=$!
ros2 launch mock_rover mock_rover.launch.xml drive_backend:=real &
rover_pid=$!
cleanup() {
  trap - TERM INT EXIT
  kill -TERM "$drivetrain_pid" "$rover_pid" 2>/dev/null || true
  wait "$drivetrain_pid" "$rover_pid" 2>/dev/null || true
}
trap cleanup TERM INT EXIT
set +e
wait -n "$drivetrain_pid" "$rover_pid"
status=$?
set -e
exit "$status"
