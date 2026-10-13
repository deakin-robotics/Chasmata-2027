from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription(
        [
            Node(
                package='mock_rover',
                executable='mock_rover',
                name='mock_rover',
                output='screen',
            ),
            Node(
                package='rosbridge_server',
                executable='rosbridge_websocket',
                name='rosbridge_websocket',
                parameters=[{'port': 9090}],
                output='screen',
            ),
        ]
    )
