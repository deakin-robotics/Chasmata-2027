from launch import LaunchDescription
from launch.actions import ExecuteProcess
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
            ExecuteProcess(
                cmd=[
                    'python3',
                    '/workspace/src/mock_rover/mock_rover/camera_server.py',
                    '--port',
                    '8080',
                    '--image',
                    '/workspace/src/mock_rover/cameras/front.gif',
                ],
                name='mock_front_camera',
                output='screen',
            ),
            ExecuteProcess(
                cmd=[
                    'python3',
                    '/workspace/src/mock_rover/mock_rover/camera_server.py',
                    '--port',
                    '8091',
                    '--image',
                    '/workspace/src/mock_rover/cameras/arm.gif',
                ],
                name='mock_arm_camera',
                output='screen',
            ),
            ExecuteProcess(
                cmd=[
                    'python3',
                    '/workspace/src/mock_rover/mock_rover/camera_server.py',
                    '--port',
                    '8090',
                    '--image',
                    '/workspace/src/mock_rover/cameras/gimbal.gif',
                ],
                name='mock_gimbal_camera',
                output='screen',
            ),
        ]
    )
