import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import (
    DeclareLaunchArgument,
    IncludeLaunchDescription,
    TimerAction,
)
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():

    # ── Launch argument ───────────────────────────────────────────────────────
    # Set to 'true' when running with Isaac Sim so all nodes share /clock.
    # Default is 'false' for laptop-only testing with fake sensors.
    use_sim_time_arg = DeclareLaunchArgument(
        name='use_sim_time',
        default_value='false',
        description="Use /clock from a simulator (Isaac Sim). Set 'true' with Isaac Sim."
    )
    use_sim_time = LaunchConfiguration('use_sim_time')

    # ── Package directories ───────────────────────────────────────────────────
    description_dir   = get_package_share_directory('chasmata_description')
    localization_dir  = get_package_share_directory('chasmata_localization')
    mapping_dir       = get_package_share_directory('chasmata_mapping')

    # ── 1. Robot description (URDF → /robot_description, TF tree, RViz) ──────
    description_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(description_dir, 'launch', 'description.launch.py')
        ),
        launch_arguments={'use_sim_time': use_sim_time}.items()
    )

    # ── 2. Fake sensors (LiDAR + IMU + wheel odom + /rover/heartbeat) ────────
    # Skipped in hardware bringup — only used for laptop simulation.
    fake_sensors_node = Node(
        package='chasmata_fake_sensors',
        executable='fake_sensors',
        name='fake_sensors',
        output='screen',
        parameters=[{'use_sim_time': use_sim_time}]
    )

    # ── 2b. Interactive obstacle server ───────────────────────────────────────
    # Publishes 2 draggable boxes in RViz.  Drag them onto the robot's path to
    # test obstacle detection; drag them off to watch the robot drive freely.
    obstacle_server_node = Node(
        package='chasmata_fake_sensors',
        executable='obstacle_server',
        name='obstacle_server',
        output='screen',
        parameters=[{'use_sim_time': use_sim_time}]
    )

    # ── 3. Localization / EKF (delay 2 s to let /robot_description publish) ──
    localization_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(localization_dir, 'launch', 'localization.launch.py')
        ),
        launch_arguments={'use_sim_time': use_sim_time}.items()
    )
    delayed_localization = TimerAction(period=2.0, actions=[localization_launch])

    # ── 4. SLAM Toolbox (delay 4 s to let EKF establish odom→base_link TF) ───
    mapping_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(mapping_dir, 'launch', 'mapping.launch.py')
        ),
        launch_arguments={'use_sim_time': use_sim_time}.items()
    )
    delayed_mapping = TimerAction(period=4.0, actions=[mapping_launch])

    return LaunchDescription([
        use_sim_time_arg,
        description_launch,
        fake_sensors_node,
        obstacle_server_node,
        delayed_localization,
        delayed_mapping,
    ])
