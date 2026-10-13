"""
hardware_bringup.launch.py
==========================
Launch the full autonomous stack on real hardware (no fake sensors).

Usage (default — LiDAR driver already publishes to /scan):
  ros2 launch chasmata_bringup hardware_bringup.launch.py

Usage (LiDAR driver publishes to a different topic):
  ros2 launch chasmata_bringup hardware_bringup.launch.py lidar_topic:=/rplidar/scan

Arguments
---------
lidar_topic   Topic the real LiDAR driver publishes LaserScan to.
              Default: /scan (no remapping needed).
              Example: /rplidar/scan, /lidar/scan, /sensors/lidar

use_sim_time  Set to 'true' when running inside Isaac Sim so all nodes
              share /clock.  Default: false.
"""

import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import (
    DeclareLaunchArgument,
    IncludeLaunchDescription,
    TimerAction,
)
from launch.conditions import IfCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration, NotEqualsSubstitution
from launch_ros.actions import Node


def generate_launch_description():

    # ── Launch arguments ──────────────────────────────────────────────────────
    use_sim_time_arg = DeclareLaunchArgument(
        name='use_sim_time',
        default_value='false',
        description="Use /clock from a simulator (Isaac Sim). Set 'true' with Isaac Sim."
    )

    lidar_topic_arg = DeclareLaunchArgument(
        name='lidar_topic',
        default_value='/scan',
        description=(
            'Topic the real LiDAR driver publishes LaserScan messages on. '
            'If already /scan, no relay is launched. '
            'Example: /rplidar/scan'
        )
    )

    use_sim_time  = LaunchConfiguration('use_sim_time')
    lidar_topic   = LaunchConfiguration('lidar_topic')

    # ── Package directories ───────────────────────────────────────────────────
    description_dir   = get_package_share_directory('chasmata_description')
    localization_dir  = get_package_share_directory('chasmata_localization')
    mapping_dir       = get_package_share_directory('chasmata_mapping')

    # ── 1. Robot description (URDF → /robot_description, TF tree) ────────────
    description_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(description_dir, 'launch', 'description.launch.py')
        ),
        launch_arguments={'use_sim_time': use_sim_time}.items()
    )

    # ── 2. LiDAR topic relay (only launched when lidar_topic != /scan) ────────
    # Bridges the real driver's topic to the /scan name used by SLAM Toolbox.
    # Uses topic_tools/relay which is a lightweight passthrough node.
    # If the driver already publishes to /scan this node is not started.
    #
    # ASSUMPTION: The real LiDAR driver is already running (started separately
    # by Forrest's control stack or a dedicated sensor bringup).
    lidar_relay_node = Node(
        package='topic_tools',
        executable='relay',
        name='lidar_relay',
        output='screen',
        arguments=[lidar_topic, '/scan'],
        parameters=[{'use_sim_time': use_sim_time}],
        # Only launch when the driver topic is NOT already /scan
        condition=IfCondition(
            NotEqualsSubstitution(lidar_topic, '/scan')
        )
    )

    # ── 3. Localization / EKF ─────────────────────────────────────────────────
    localization_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(localization_dir, 'launch', 'localization.launch.py')
        ),
        launch_arguments={'use_sim_time': use_sim_time}.items()
    )
    delayed_localization = TimerAction(period=2.0, actions=[localization_launch])

    # ── 4. SLAM Toolbox ───────────────────────────────────────────────────────
    mapping_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(mapping_dir, 'launch', 'mapping.launch.py')
        ),
        launch_arguments={'use_sim_time': use_sim_time}.items()
    )
    delayed_mapping = TimerAction(period=4.0, actions=[mapping_launch])

    return LaunchDescription([
        use_sim_time_arg,
        lidar_topic_arg,
        description_launch,
        lidar_relay_node,
        delayed_localization,
        delayed_mapping,
    ])
