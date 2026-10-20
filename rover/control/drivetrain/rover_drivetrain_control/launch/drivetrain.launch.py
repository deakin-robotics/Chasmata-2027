"""Drivetrain ros2_control stack with two command sources.

robot_state_publisher and ros2_control_node with the real RoverHardwareInterface,
all in the /drivetrain namespace, plus spawners and the direct-drive relay.

The hardware refuses on_configure() until it is verified. The controller
manager stays up with the hardware unconfigured, and the spawners that need it
exit with an error that this launch explains instead of treating it as a crash.
"""

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, LogInfo, RegisterEventHandler
from launch.event_handlers import OnProcessExit
from launch.substitutions import Command, FindExecutable, LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue
from launch_ros.substitutions import FindPackageShare

NAMESPACE = 'drivetrain'
CONTROLLER_MANAGER = '/drivetrain/controller_manager'


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
            f'[drivetrain] {controller} did not reach its requested state. Expected while '
            'RoverHardwareInterface refuses on_configure(): the hardware stays '
            'unconfigured, so no controller can activate and nothing can move. Check with: '
            f'ros2 control list_hardware_components -c {CONTROLLER_MANAGER}'))]
    return on_exit


def generate_launch_description():
    share = FindPackageShare('rover_drivetrain_control')
    controllers_file = PathJoinSubstitution([share, 'config', 'drivetrain_controllers.yaml'])
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

    return LaunchDescription([
        # No default on purpose: every hardware value must be supplied explicitly.
        DeclareLaunchArgument(
            'hardware_config',
            description='YAML file with the drivetrain hardware values; '
                        'see config/drivetrain_hardware.example.yaml'),
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
    ])
