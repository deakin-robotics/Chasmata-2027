#!/usr/bin/env bash
set -euo pipefail

DRIVE_LIMITS=$(python3 - <<'PY'
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
    radius = float(config['wheel_radius'])
    separation = float(config['wheel_separation'])
    if not math.isfinite(ratio) or ratio <= 0 or not math.isfinite(limit) or limit <= 0:
        raise ValueError('gear_ratio and motor_rpm_limit must be positive and finite')
    if config.get('bench_motion_enabled') is not True:
        raise ValueError('bench_motion_enabled must be true for drivetrain motion')
    bench_cap = float(config['bench_rpm_cap'])
    if not math.isfinite(bench_cap) or bench_cap <= 0 or bench_cap > 500:
        raise ValueError('bench_rpm_cap must be positive and at most 500 RPM')
    limit = min(800.0, limit, bench_cap)
    if not math.isfinite(radius) or radius <= 0 or not math.isfinite(separation) or separation <= 0:
        raise ValueError('wheel_radius and wheel_separation must be positive finite metres')
    print(limit * 2 * math.pi / (60 * ratio), radius, separation)
except (OSError, KeyError, TypeError, ValueError, yaml.YAMLError) as error:
    print(f'Invalid drivetrain configuration: {error}', file=sys.stderr)
    sys.exit(1)
PY
)
read -r DRIVE_MAX_WHEEL_SPEED DRIVE_WHEEL_RADIUS DRIVE_WHEEL_SEPARATION <<< "$DRIVE_LIMITS"
export DRIVE_MAX_WHEEL_SPEED DRIVE_WHEEL_RADIUS DRIVE_WHEEL_SEPARATION

ARM_CAN_INTERFACE=$(python3 - <<'PY'
import os
import re
import sys
import yaml

try:
    root = '/etc/rover/arm'
    with open(os.path.join(root, 'arm_hardware.yaml'), encoding='utf-8') as config_file:
        config = yaml.safe_load(config_file)
    interface = config.get('can_interface') if isinstance(config, dict) else None
    if not isinstance(interface, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,15}', interface):
        raise ValueError('can_interface must name the commissioned SocketCAN interface')
    for name in ('arm_manual.yaml', 'robot_arm.urdf', 'arm_controllers.yaml'):
        if not os.path.isfile(os.path.join(root, name)):
            raise ValueError(f'missing commissioned arm configuration: {name}')
    with open(f'/sys/class/net/{interface}/type', encoding='ascii') as interface_type:
        if interface_type.read().strip() != '280':
            raise ValueError(f'{interface} is not a CAN interface')
    print(interface)
except (OSError, ValueError, yaml.YAMLError) as error:
    print(f'Invalid arm configuration: {error}', file=sys.stderr)
    sys.exit(1)
PY
)

set +u
source /opt/ros/jazzy/setup.bash
source /workspace/install/setup.bash
set -u
ros2 launch rover_drivetrain_control drivetrain.launch.py hardware_config:=/etc/rover/drivetrain/drivetrain_hardware.yaml &
drivetrain_pid=$!
ros2 run nobleo_socketcan_bridge socketcan_bridge --ros-args -p interface:="$ARM_CAN_INTERFACE" &
can_pid=$!
ros2 launch dcr_arm_driver arm_control.launch.py urdf:=/etc/rover/arm/robot_arm.urdf controllers:=/etc/rover/arm/arm_controllers.yaml &
arm_pid=$!
ros2 launch rover rover.launch.xml drive_backend:=real arm_backend:=real arm_manual_config:=/etc/rover/arm/arm_manual.yaml &
rover_pid=$!
cleanup() {
  trap - TERM INT EXIT
  kill -TERM "$drivetrain_pid" "$can_pid" "$arm_pid" "$rover_pid" 2>/dev/null || true
  wait "$drivetrain_pid" "$can_pid" "$arm_pid" "$rover_pid" 2>/dev/null || true
}
trap cleanup TERM INT EXIT
set +e
wait -n "$drivetrain_pid" "$can_pid" "$arm_pid" "$rover_pid"
status=$?
set -e
exit "$status"
