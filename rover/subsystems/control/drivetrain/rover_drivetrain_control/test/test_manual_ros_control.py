#!/usr/bin/env python3
"""Exercise the real Manual backend against a simulated ros2_control system."""
import math
import time

import rclpy
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from sensor_msgs.msg import Joy, JointState
from std_msgs.msg import Float64MultiArray, String
from telemetry_interfaces.msg import FmaState
from geometry_msgs.msg import TwistStamped


def main():
    rclpy.init()
    node = Node('manual_path_test')
    state = {'confirmed': '', 'commands': [], 'velocity': [], 'joints': []}
    qos = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE,
                     durability=DurabilityPolicy.TRANSIENT_LOCAL)
    fma_sub = node.create_subscription(FmaState, '/fma/state',
                                       lambda msg: state.update(confirmed=msg.drive.confirmed), qos)
    wheel_sub = node.create_subscription(Float64MultiArray, '/drivetrain/wheel_velocity_controller/commands',
                                         lambda msg: state['commands'].append(list(msg.data)), 10)
    velocity_sub = node.create_subscription(TwistStamped, '/drivetrain/diff_drive_controller/cmd_vel',
                                            lambda msg: state['velocity'].append(msg.twist), 10)
    joints_sub = node.create_subscription(JointState, '/drivetrain/joint_states',
                                          lambda msg: state['joints'].append(list(msg.velocity)), 10)
    request = node.create_publisher(String, '/fma/drive/request', 10)
    joy = node.create_publisher(Joy, '/drive/joy', 10)

    def wait(predicate, seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            rclpy.spin_once(node, timeout_sec=0.05)
            if predicate():
                return True
        return False

    try:
        assert wait(lambda: request.get_subscription_count() and joy.get_subscription_count(), 15), 'rover subscriptions unavailable'
        request.publish(String(data='MANUAL'))
        assert wait(lambda: state['confirmed'] == 'MANUAL', 10), 'Manual handoff not confirmed'
        target = 800 * 2 * math.pi / (60 * 50)
        manual_joy = Joy(axes=[0.0, 0.0, 0.0, 0.0, 0.5, 1.0], buttons=[0, 0, 0, 0])
        def manual_received():
            joy.publish(manual_joy)
            return any(len(c) == 4 and abs(c[0] - target / 2) < 1e-5 and
                       abs(c[1] - target / 2) < 1e-5 and abs(c[2] - target) < 1e-5 and
                       abs(c[3] - target) < 1e-5 for c in state['commands'])
        assert wait(manual_received, 5), 'wheel command not received'
        assert wait(lambda: bool(state['commands']) and all(abs(v) < 1e-9 for v in state['commands'][-1]), 2), 'relay did not stop after timeout'
        request.publish(String(data='VELOCITY'))
        assert wait(lambda: state['confirmed'] == 'VELOCITY', 10), 'Velocity handoff not confirmed'
        state['velocity'].clear()
        state['joints'].clear()
        velocity_joy = Joy(axes=[1.0, -1.0, 0.0, 0.0, 0.0, 0.0], buttons=[])
        for _ in range(15):
            joy.publish(velocity_joy)
            rclpy.spin_once(node, timeout_sec=0.03)
            time.sleep(0.02)
        assert wait(lambda: any(abs(v.linear.x - target * 0.1 / 2) < 1e-5 and
                                abs(v.angular.z + target * 0.1 / 0.5) < 1e-5
                                for v in state['velocity']), 5), 'velocity command not received'
        assert wait(lambda: any(any(abs(v) > 1e-5 for v in sample) for sample in state['joints']), 3), 'simulated wheels did not move'
        assert wait(lambda: bool(state['joints']) and state['joints'][-1] and
                    all(abs(v) < 1e-5 for v in state['joints'][-1]), 3), 'velocity controller did not stop after timeout'
        request.publish(String(data='MANUAL'))
        assert wait(lambda: state['confirmed'] == 'MANUAL', 10), 'Manual handback not confirmed'
        print('Manual and Velocity FMA, ros2_control commands and timeout passed')
    finally:
        node.destroy_subscription(fma_sub)
        node.destroy_subscription(wheel_sub)
        node.destroy_subscription(velocity_sub)
        node.destroy_subscription(joints_sub)
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
