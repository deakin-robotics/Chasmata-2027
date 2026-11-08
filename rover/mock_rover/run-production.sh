#!/usr/bin/env bash
set -euo pipefail

: "${DRIVE_HARDWARE_CONFIG:?Set DRIVE_HARDWARE_CONFIG to the verified drivetrain YAML path}"
: "${DRIVE_SERIAL_DEVICE:?Set DRIVE_SERIAL_DEVICE to the drivetrain serial device path}"
test -c "$DRIVE_SERIAL_DEVICE" || { printf 'Drivetrain serial device is not available: %s\n' "$DRIVE_SERIAL_DEVICE" >&2; exit 1; }
DRIVE_MAX_WHEEL_SPEED=$(python3 - <<'PY'
import math
import os
import sys
import yaml

try:
    with open('/etc/rover/drivetrain-hardware.yaml', encoding='utf-8') as config_file:
        config = yaml.safe_load(config_file)
    if not isinstance(config, dict) or config.get('serial_device') != os.environ['DRIVE_SERIAL_DEVICE']:
        raise ValueError('DRIVE_SERIAL_DEVICE must match serial_device in the hardware YAML')
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
ros2 launch rover_drivetrain_control drivetrain.launch.py hardware_config:=/etc/rover/drivetrain-hardware.yaml &
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
