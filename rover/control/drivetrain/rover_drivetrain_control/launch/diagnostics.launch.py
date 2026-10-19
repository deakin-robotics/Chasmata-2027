from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument('enable_readonly_probe', default_value='false'),
        Node(
            package='rover_drivetrain_control',
            executable='drivetrain_diagnostics_node',
            name='drivetrain_diagnostics',
            output='screen',
            parameters=[{'enable_readonly_probe': LaunchConfiguration('enable_readonly_probe')}],
        ),
    ])
