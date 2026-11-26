from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument('enable_readonly_probe', default_value='false'),
        DeclareLaunchArgument('serial_device', default_value=''),
        DeclareLaunchArgument('baud_rate', default_value='0'),
        DeclareLaunchArgument('parity', default_value=''),
        DeclareLaunchArgument('data_bits', default_value='0'),
        DeclareLaunchArgument('stop_bits', default_value='0'),
        DeclareLaunchArgument('response_timeout_ms', default_value='30'),
        Node(
            package='rover_drivetrain_control',
            executable='drivetrain_diagnostics_node',
            name='drivetrain_diagnostics',
            output='screen',
            # ROS's YAML parser treats bare N as a boolean. Explicit YAML quotes
            # on the CLI preserve the parity code as a string.
            arguments=['--ros-args', '-p', ['parity:="', LaunchConfiguration('parity'), '"']],
            parameters=[{
                'enable_readonly_probe': ParameterValue(
                    LaunchConfiguration('enable_readonly_probe'), value_type=bool),
                'serial_device': ParameterValue(
                    LaunchConfiguration('serial_device'), value_type=str),
                'baud_rate': ParameterValue(LaunchConfiguration('baud_rate'), value_type=int),
                'data_bits': ParameterValue(LaunchConfiguration('data_bits'), value_type=int),
                'stop_bits': ParameterValue(LaunchConfiguration('stop_bits'), value_type=int),
                'response_timeout_ms': ParameterValue(
                    LaunchConfiguration('response_timeout_ms'), value_type=int),
            }],
        ),
    ])
