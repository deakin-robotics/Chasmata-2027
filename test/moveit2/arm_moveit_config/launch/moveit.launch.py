from launch import LaunchDescription
from launch_ros.actions import Node
from moveit_configs_utils import MoveItConfigsBuilder


def generate_launch_description():
    moveit_config = (
        MoveItConfigsBuilder('arm', package_name='arm_moveit_config')
        .robot_description(file_path='config/arm.urdf')
        .robot_description_semantic(file_path='config/arm.srdf')
        .robot_description_kinematics(file_path='config/kinematics.yaml')
        .joint_limits(file_path='config/joint_limits.yaml')
        .planning_pipelines(pipelines=['ompl'], default_planning_pipeline='ompl')
        .trajectory_execution(file_path='config/moveit_controllers.yaml')
        .planning_scene_monitor(
            publish_robot_description=True,
            publish_robot_description_semantic=True,
        )
        .to_moveit_configs()
    )

    return LaunchDescription(
        [
            Node(
                package='tf2_ros',
                executable='static_transform_publisher',
                name='world_to_base_link',
                arguments=['--frame-id', 'world', '--child-frame-id', 'base_link'],
                output='screen',
            ),
            Node(
                package='robot_state_publisher',
                executable='robot_state_publisher',
                name='robot_state_publisher',
                parameters=[moveit_config.robot_description],
                output='screen',
            ),
            Node(
                package='moveit_ros_move_group',
                executable='move_group',
                name='move_group',
                parameters=[
                    moveit_config.to_dict(),
                    {'moveit_manage_controllers': False},
                ],
                output='screen',
            ),
        ]
    )
