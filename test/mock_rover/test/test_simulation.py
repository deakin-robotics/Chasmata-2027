import pytest

from mock_rover.simulation import JointSimulator


JOINT_NAMES = ('base_joint', 'shoulder_joint')
JOINT_LIMITS = {
    'base_joint': (-1.0, 1.0),
    'shoulder_joint': (-0.5, 0.5),
}


def test_joint_targets_are_clamped_to_limits():
    simulator = JointSimulator(JOINT_NAMES, JOINT_LIMITS, 1.0)

    accepted = simulator.set_target({'base_joint': 5.0, 'shoulder_joint': -2.0})

    assert accepted == {'base_joint': 1.0, 'shoulder_joint': -0.5}


def test_joints_move_at_or_below_the_configured_speed():
    simulator = JointSimulator(JOINT_NAMES, JOINT_LIMITS, 1.0)
    simulator.set_target({'base_joint': 1.0})

    simulator.step(0.25)

    assert simulator.positions()['base_joint'] == pytest.approx(0.25)
    assert simulator.velocities()['base_joint'] == pytest.approx(1.0)


def test_joints_stop_at_the_target():
    simulator = JointSimulator(JOINT_NAMES, JOINT_LIMITS, 1.0)
    simulator.set_target({'base_joint': 0.2})

    simulator.step(1.0)

    assert simulator.positions()['base_joint'] == pytest.approx(0.2)
    assert simulator.velocities()['base_joint'] == pytest.approx(0.0)
