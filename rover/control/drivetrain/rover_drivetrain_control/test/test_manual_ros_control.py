#!/usr/bin/env python3
"""Exercise the real Manual backend against a simulated ros2_control system."""
import math
import time

import rclpy
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from sensor_msgs.msg import Joy
from std_msgs.msg import Float64MultiArray, String
from telemetry_interfaces.msg import FmaState


def main():
    rclpy.init()
    node = Node('manual_path_test')
    state = {'confirmed': False, 'commands': []}
    qos = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE,
                     durability=DurabilityPolicy.TRANSIENT_LOCAL)
    fma_sub = node.create_subscription(FmaState, '/fma/state',
                                       lambda msg: state.update(confirmed=msg.drive.confirmed == 'MANUAL'), qos)
    wheel_sub = node.create_subscription(Float64MultiArray, '/drivetrain/wheel_velocity_controller/commands',
                                         lambda msg: state['commands'].append(list(msg.data)), 10)
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
        assert wait(lambda: state['confirmed'], 10), 'Manual handoff not confirmed'
        target = 800 * 2 * math.pi / (60 * 50)
        joy.publish(Joy(axes=[0.0, 0.0, 0.0, 0.0, 0.5, 1.0], buttons=[0, 0, 0, 0]))
        assert wait(lambda: any(len(c) == 4 and abs(c[0] - target / 2) < 1e-5 and
                                abs(c[1] - target / 2) < 1e-5 and abs(c[2] - target) < 1e-5 and
                                abs(c[3] - target) < 1e-5 for c in state['commands']), 5), 'wheel command not received'
        assert wait(lambda: bool(state['commands']) and all(abs(v) < 1e-9 for v in state['commands'][-1]), 2), 'relay did not stop after timeout'
        print('Manual FMA, ros2_control wheel command and timeout passed')
    finally:
        node.destroy_subscription(fma_sub)
        node.destroy_subscription(wheel_sub)
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
