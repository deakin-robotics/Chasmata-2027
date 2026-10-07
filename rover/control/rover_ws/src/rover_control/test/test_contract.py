from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = PACKAGE_ROOT.parents[4]
PRODUCTION_SOURCE = PACKAGE_ROOT / 'src' / 'rover_control_node.cpp'
MOCK_SOURCE = REPOSITORY_ROOT / 'test' / 'mock_rover' / 'mock_rover' / 'mock_rover_node.py'


ENDPOINTS = (
    '/joint_states',
    '/arm_controller/follow_joint_trajectory',
    '/joint_commands',
    '/joy',
    '/arm/joy',
    '/arm/orientation_lock',
    '/fma/drive/request',
    '/fma/arm/request',
    '/arm/override/request',
    '/fma/gimbal/request',
    '/fma/state',
)


def test_production_and_mock_keep_the_same_ros_endpoints():
    production = PRODUCTION_SOURCE.read_text(encoding='utf-8')
    mock = MOCK_SOURCE.read_text(encoding='utf-8')

    for endpoint in ENDPOINTS:
        assert endpoint in production
        assert endpoint in mock


def test_production_and_mock_use_the_same_contract_types():
    production = PRODUCTION_SOURCE.read_text(encoding='utf-8')
    mock = MOCK_SOURCE.read_text(encoding='utf-8')

    assert 'control_msgs/action/follow_joint_trajectory.hpp' in production
    assert 'from control_msgs.action import FollowJointTrajectory' in mock
    assert 'sensor_msgs/msg/joint_state.hpp' in production
    assert 'from sensor_msgs.msg import JointState, Joy' in mock
    assert 'std_msgs/msg/bool.hpp' in production
    assert 'from std_msgs.msg import Bool, String' in mock
