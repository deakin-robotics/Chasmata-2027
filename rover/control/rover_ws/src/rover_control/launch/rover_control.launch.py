from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription(
        [
            Node(
                package='rover_control',
                executable='rover_control_node',
                name='rover_control',
                output='screen',
            )
        ]
    )
