import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    pkg_share = get_package_share_directory('dcr_arm_driver')

    urdf_file = os.path.join(pkg_share, 'urdf', 'robot_arm.urdf')
    controller_config = os.path.join(pkg_share, 'config', 'arm_controllers.yaml')

    # controller_manager expects the URDF *contents* (string) on the
    # robot_description parameter - not a file path. Passing a path makes it
    # fall back to waiting on the 'robot_description' topic.
    with open(urdf_file, 'r') as f:
        robot_description = f.read()

    return LaunchDescription([
        # Publishes the robot_description topic so controller_manager and
        # other tools (rviz, moveit) can consume the URDF.
        Node(
            package='robot_state_publisher',
            executable='robot_state_publisher',
            parameters=[{'robot_description': robot_description}],
            output='screen',
        ),
        # ros2_control node (main control manager)
        Node(
            package='controller_manager',
            executable='ros2_control_node',
            parameters=[
                {'robot_description': robot_description},
                controller_config,
            ],
            output='screen',
        ),
        # Spawn joint state broadcaster
        Node(
            package='controller_manager',
            executable='spawner',
            arguments=['joint_state_broadcaster'],
        ),
        # Spawn arm controller
        Node(
            package='controller_manager',
            executable='spawner',
            arguments=['arm_controller'],
        ),
    ])