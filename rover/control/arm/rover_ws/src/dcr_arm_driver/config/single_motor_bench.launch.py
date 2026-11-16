from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument('interface', default_value='can0'),
        DeclareLaunchArgument('motor_id', default_value='5'),
        DeclareLaunchArgument('shortest_path', default_value='true'),
        Node(
            package='nobleo_socketcan_bridge', executable='socketcan_bridge',
            name='bench_socketcan_bridge', output='screen',
            parameters=[{'interface': LaunchConfiguration('interface')}],
            remappings=[('~/tx', '/arm/bench/tx'), ('~/rx', '/arm/bench/rx')],
        ),
        Node(
            package='dcr_arm_driver', executable='single_motor_bench',
            output='screen',
            parameters=[{'motor_id': ParameterValue(
                LaunchConfiguration('motor_id'), value_type=int),
                'shortest_path': ParameterValue(
                    LaunchConfiguration('shortest_path'), value_type=bool)}],
        ),
    ])
