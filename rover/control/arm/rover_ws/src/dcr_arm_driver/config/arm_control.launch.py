from launch import LaunchDescription
from launch_ros.actions import Node
from launch.substitutions import PathJoinSubstitution, LaunchConfiguration
from launch_ros.substitutions import FindPackageShare 
from pathlib import Path

def generate_launch_description():
    pkg_share = FindPackageShare('dcr_arm_driver')
    
    # Use PathJoinSubstitution for dynamic paths
    urdf_file = PathJoinSubstitution([pkg_share, 'urdf', 'robot_arm.urdf'])
    controller_config = PathJoinSubstitution([pkg_share, 'config', 'arm_controllers.yaml'])
    
    return LaunchDescription([
        # ros2_control node (main control manager)
        Node(
            package='controller_manager',
            executable='ros2_control_node',
            parameters=[
                {'robot_description': urdf_file},
                controller_config
            ]
        ),
        # Spawn joint state broadcaster
        Node(
            package='controller_manager',
            executable='spawner',
            arguments=['joint_state_broadcaster']
        ),
        # Spawn arm controller
        Node(
            package='controller_manager',
            executable='spawner',
            arguments=['arm_controller']
        ),
    ])