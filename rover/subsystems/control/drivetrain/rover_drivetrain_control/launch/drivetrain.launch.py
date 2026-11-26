"""Drivetrain ros2_control stack with two command sources.

robot_state_publisher and ros2_control_node with the real RoverHardwareInterface,
all in the /drivetrain namespace, plus spawners and the direct-drive relay.

The hardware requires the explicitly configured bench mode before it can move.
"""

from launch import LaunchDescription
import math
import os
import tempfile

import yaml
from ament_index_python.packages import get_package_share_directory
from launch.actions import DeclareLaunchArgument, LogInfo, OpaqueFunction, RegisterEventHandler
from launch.event_handlers import OnProcessExit
from launch.substitutions import Command, FindExecutable, LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue
from launch_ros.substitutions import FindPackageShare

NAMESPACE = 'drivetrain'
CONTROLLER_MANAGER = '/drivetrain/controller_manager'
_temporary_configs = []


def _spawner(controller, controllers_file, inactive=False):
    arguments = [controller, '--controller-manager', CONTROLLER_MANAGER,
                 '--param-file', controllers_file]
    if inactive:
        arguments.append('--inactive')
    return Node(
        package='controller_manager',
        executable='spawner',
        namespace=NAMESPACE,
        name=f'spawner_{controller}',
        arguments=arguments,
        output='screen',
    )


def _explain_spawner_exit(controller):
    def on_exit(event, context):
        if event.returncode == 0:
            return []
        return [LogInfo(msg=(
            f'[drivetrain] {controller} did not reach its requested state. Check with: '
            f'ros2 control list_hardware_components -c {CONTROLLER_MANAGER}'))]
    return on_exit


def _launch_nodes(context):
    share = FindPackageShare('rover_drivetrain_control')
    hardware_file = LaunchConfiguration('hardware_config').perform(context)
    with open(hardware_file, encoding='utf-8') as stream:
        hardware_config = yaml.safe_load(stream)
    with open(os.path.join(get_package_share_directory('rover_drivetrain_control'),
                           'config', 'drivetrain_controllers.yaml'), encoding='utf-8') as stream:
        controllers = yaml.safe_load(stream)
    radius = float(hardware_config['wheel_radius'])
    separation = float(hardware_config['wheel_separation'])
    if not all(math.isfinite(value) and value > 0 for value in (radius, separation)):
        raise ValueError('wheel_radius and wheel_separation must be positive finite metres')
    params = controllers['/drivetrain/diff_drive_controller']['ros__parameters']
    params['wheel_radius'] = radius
    params['wheel_separation'] = separation
    temporary_dir = tempfile.TemporaryDirectory(prefix='drivetrain_config_')
    _temporary_configs.append(temporary_dir)
    controllers_file = os.path.join(temporary_dir.name, 'controllers.yaml')
    with open(controllers_file, 'w', encoding='utf-8') as stream:
        yaml.safe_dump(controllers, stream)
    robot_description = ParameterValue(
        Command([
            FindExecutable(name='xacro'), ' ',
            PathJoinSubstitution([share, 'urdf', 'drivetrain.urdf.xacro']),
            ' hardware_config:=', LaunchConfiguration('hardware_config'),
        ]),
        value_type=str,
    )

    spawners = [
        ('joint_state_broadcaster', _spawner('joint_state_broadcaster', controllers_file)),
        ('diff_drive_controller', _spawner('diff_drive_controller', controllers_file)),
        ('wheel_velocity_controller',
         _spawner('wheel_velocity_controller', controllers_file, inactive=True)),
    ]

    return [
        Node(
            package='robot_state_publisher',
            executable='robot_state_publisher',
            namespace=NAMESPACE,
            parameters=[{'robot_description': robot_description}],
            output='screen',
        ),
        Node(
            package='controller_manager',
            executable='ros2_control_node',
            namespace=NAMESPACE,
            parameters=[controllers_file],
            output='screen',
        ),
        *[action for _, action in spawners],
        *[RegisterEventHandler(OnProcessExit(
            target_action=action, on_exit=_explain_spawner_exit(controller)))
          for controller, action in spawners],
        Node(
            package='rover_drivetrain_control',
            executable='direct_drive_relay',
            namespace=NAMESPACE,
            output='screen',
        ),
    ]


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument(
            'hardware_config',
            description='YAML file with the drivetrain hardware values; '
                        'see config/drivetrain_hardware.example.yaml'),
        OpaqueFunction(function=_launch_nodes),
    ])
