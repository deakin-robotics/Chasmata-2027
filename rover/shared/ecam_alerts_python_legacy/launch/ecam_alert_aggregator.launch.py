from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument('role', default_value='rover'),
        Node(
            package='ecam_alerts',
            executable='ecam_alert_aggregator',
            name=['ecam_alert_aggregator_', LaunchConfiguration('role')],
            output='screen',
            parameters=[{'role': LaunchConfiguration('role')}],
        ),
    ])
