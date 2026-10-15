from launch import LaunchDescription
from launch_ros.actions import Node
from launch.substitutions import PathJoinSubstitution
from launch_ros.substitutions import FindPackageShare


def generate_launch_description():
    pkg_share = FindPackageShare('dcr_ee_driver')
    params_file = PathJoinSubstitution([pkg_share, 'config', 'ee_params.yaml'])

    return LaunchDescription([
        Node(
            package='dcr_ee_driver',
            executable='ee_driver_node',
            name='ee_driver_node',
            output='screen',
            parameters=[params_file],
        ),
    ])
