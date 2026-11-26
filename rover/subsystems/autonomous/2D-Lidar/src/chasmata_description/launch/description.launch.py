import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration, Command
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue


def generate_launch_description():
    pkg_share = get_package_share_directory('chasmata_description')
    default_model_path = os.path.join(pkg_share, 'urdf', 'chasmata.urdf.xacro')
    rviz_config_path   = os.path.join(pkg_share, 'rviz', 'urdf.rviz')

    use_sim_time_arg = DeclareLaunchArgument(
        name='use_sim_time',
        default_value='false',
        description='Use simulation (Isaac Sim) clock if true'
    )
    use_sim_time = LaunchConfiguration('use_sim_time')

    # ParameterValue(value_type=str) is required in ROS 2 Humble so the launch
    # system does not try to YAML-parse the raw URDF XML string.
    robot_description = ParameterValue(
        Command(['xacro ', default_model_path]),
        value_type=str
    )

    return LaunchDescription([
        use_sim_time_arg,

        Node(
            package='robot_state_publisher',
            executable='robot_state_publisher',
            output='screen',
            parameters=[{
                'robot_description': robot_description,
                'use_sim_time': use_sim_time,
            }]
        ),

        Node(
            package='joint_state_publisher',
            executable='joint_state_publisher',
            name='joint_state_publisher',
            parameters=[{'use_sim_time': use_sim_time}]
        ),

        Node(
            package='rviz2',
            executable='rviz2',
            name='rviz2',
            output='screen',
            arguments=['-d', rviz_config_path]
        ),
    ])

