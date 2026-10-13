import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node

def generate_launch_description():
    pkg_share = get_package_share_directory('chasmata_mapping')
    slam_config_path = os.path.join(pkg_share, 'config', 'mapper_params_online_async.yaml')

    return LaunchDescription([
        DeclareLaunchArgument(
            name='use_sim_time', 
            default_value='false',
            description='Use simulation clock if true'
        ),
        
        Node(
            package='slam_toolbox',
            executable='async_slam_toolbox_node',
            name='slam_toolbox',
            output='screen',
            parameters=[
                slam_config_path, 
                {'use_sim_time': LaunchConfiguration('use_sim_time')}
            ]
        )
    ])
