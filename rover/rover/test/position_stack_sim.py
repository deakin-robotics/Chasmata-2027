#!/usr/bin/env python3
"""Exercise Rover Control, ros2_control and a single-joint simulated CAN bus.

Run in a sourced ROS workspace with rover and dcr_arm_driver installed. This
uses a temporary motion-enabled simulator URDF and never opens a CAN device.
"""
import math
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import rclpy
from rclpy.action import ActionClient
from rclpy.node import Node
from can_msgs.msg import Frame
from control_msgs.action import FollowJointTrajectory
from sensor_msgs.msg import Joy
from std_msgs.msg import Bool, String, UInt8
from std_srvs.srv import Trigger
from telemetry_interfaces.msg import ArmControlStatus, FmaState
from trajectory_msgs.msg import JointTrajectoryPoint
from ament_index_python.packages import get_package_share_directory


class SimulatedArm(Node):
    def __init__(self, full):
        super().__init__('stage3_simulated_can')
        self.full = full
        self.joint_ids = range(1, 7 if full else 2)
        self.counts = {joint: 0 for joint in self.joint_ids}
        self.speeds = {joint: 0 for joint in self.joint_ids}
        self.joy_axis = 0.0
        self.joy_wrist = 0.0
        self.observed_motion = False
        self.observed_wrist_during_trajectory = False
        self.unexpected_locked_wrist_motion = False
        self.fma = None
        self.status = None
        self.ownership = 0
        self.rx = self.create_publisher(Frame, '/socketcan_bridge/rx', 100)
        self.estop = self.create_publisher(Bool, '/estop', 10)
        self.joy = self.create_publisher(Joy, '/arm/joy', 10)
        self.mode = self.create_publisher(String, '/fma/arm/request', 10)
        self.lock = self.create_publisher(Bool, '/arm/orientation_lock', 10)
        self.create_subscription(Frame, '/socketcan_bridge/tx', self.on_tx, 100)
        self.create_subscription(FmaState, '/fma/state', self.on_fma, 10)
        self.create_subscription(ArmControlStatus, '/arm/control/status', self.on_status, 10)
        self.create_subscription(UInt8, '/arm/position/ownership', self.on_ownership, 10)
        self.rearm = self.create_client(Trigger, '/arm/rearm')
        self.action = ActionClient(self, FollowJointTrajectory, '/arm_controller/follow_joint_trajectory')
        self.create_timer(0.02, self.publish_feedback)
        self.create_timer(0.05, self.publish_input)

    def on_fma(self, msg):
        self.fma = msg

    def on_status(self, msg):
        self.status = msg

    def on_ownership(self, msg):
        self.ownership = msg.data

    @property
    def count(self):
        return self.counts[1]

    @property
    def speed(self):
        return self.speeds[1]

    def on_tx(self, frame):
        if frame.id not in self.counts or frame.dlc < 5:
            return
        joint = frame.id
        if frame.data[0] == 0xC2:
            self.counts[joint] = max(0, min(260, int.from_bytes(bytes(frame.data[1:5]), 'little', signed=True)))
            self.speeds[joint] = 0
        elif frame.data[0] == 0xC1:
            self.speeds[joint] = int.from_bytes(bytes(frame.data[1:5]), 'little', signed=True)
            if joint == 1 and self.speeds[joint]:
                self.observed_motion = True
            if joint == 4 and self.speeds[joint] and self.status:
                if self.status.control_owner == 3 and not self.status.motion_inhibited:
                    self.observed_wrist_during_trajectory = True
                if self.status.control_owner == 2:
                    self.unexpected_locked_wrist_motion = True

    def publish_feedback(self):
        stop = Bool(); stop.data = False; self.estop.publish(stop)
        for joint in self.joint_ids:
            if self.speeds[joint] > 0:
                self.counts[joint] = min(260, self.counts[joint] + 1)
            elif self.speeds[joint] < 0:
                self.counts[joint] = max(0, self.counts[joint] - 1)
            count = self.counts[joint]
            frame = Frame(); frame.id = joint; frame.dlc = 8; frame.header.stamp = self.get_clock().now().to_msg()
            frame.data = [0xA4, 0, 0, 0, 0, 0, count & 255, (count >> 8) & 255]
            self.rx.publish(frame)
            frame.data = [0xAE, 0x60, 0x09, 0, 0, 0, 0, 0]; self.rx.publish(frame)

    def publish_input(self):
        msg = Joy(); msg.axes = [0.0] * 10; msg.buttons = [0] * 12
        msg.axes[0] = self.joy_axis; msg.axes[6] = self.joy_wrist; self.joy.publish(msg)

    def wait(self, condition, timeout, description):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            rclpy.spin_once(self, timeout_sec=0.02)
            if condition():
                return
        reason = self.status.reason if self.status else 'no driver status'
        fma = self.fma.arm.confirmed if self.fma else 'no FMA'
        raise AssertionError(f'{description}: {reason}; FMA={fma}')


def main():
    full = '--full' in sys.argv
    rclpy.init(args=[])
    node = SimulatedArm(full)
    children = []
    with tempfile.TemporaryDirectory(prefix='arm-position-sim-') as directory:
        root = Path(directory)
        share = Path(get_package_share_directory('dcr_arm_driver'))
        urdf = (share / ('urdf/robot_arm.urdf' if full else 'urdf/single_joint_bench.urdf')).read_text()
        controllers = share / ('config/arm_controllers.yaml' if full else 'config/single_joint_bench_controllers.yaml')
        profile = root / 'sim.urdf'
        profile.write_text(urdf.replace('<param name="motion_enabled">false</param>',
                                        '<param name="motion_enabled">true</param>'))
        log = (root / 'process.log').open('w+')
        try:
            children.append(subprocess.Popen([
                'ros2', 'launch', 'dcr_arm_driver', 'arm_control.launch.py',
                f'urdf:={profile}', f'controllers:={controllers}',
            ], stdout=log, stderr=subprocess.STDOUT, start_new_session=True))
            children.append(subprocess.Popen([
                'ros2', 'run', 'rover', 'rover', '--ros-args', '-p', 'arm_backend:=real',
                '-p', 'arm_manual_speed_rpm:=[0.1,0.1,0.1,0.1,0.1,0.1]',
            ], stdout=log, stderr=subprocess.STDOUT, start_new_session=True))
            node.wait(lambda: node.status is not None and node.status.hardware_active and
                      node.status.feedback_fresh and node.status.motor_status_safe and node.status.estop_clear and
                      node.rearm.service_is_ready(), 40, 'driver startup')
            # The driver requires a 500 ms healthy dwell.
            end = time.monotonic() + 0.7
            while time.monotonic() < end:
                rclpy.spin_once(node, timeout_sec=0.02)
            future = node.rearm.call_async(Trigger.Request())
            node.wait(future.done, 5, 'rearm response')
            assert future.result().success, future.result().message
            node.wait(lambda: node.mode.get_subscription_count() > 0, 5, 'mode request subscription')
            message = String(); message.data = 'MANUAL'; node.mode.publish(message)
            node.wait(lambda: node.fma is not None and node.fma.arm.confirmed == 'MANUAL', 8, 'Manual confirmation')
            node.joy_axis = 0.5
            node.wait(lambda: node.observed_motion, 5, 'simulated Manual motion')
            node.joy_axis = 0.0
            node.wait(lambda: node.speed == 0, 3, 'Manual neutral')
            message.data = 'POSITION'; node.mode.publish(message)
            node.wait(lambda: node.fma is not None and node.fma.arm.confirmed == 'POSITION', 8, 'Position confirmation')
            node.wait(node.action.server_is_ready, 5, 'trajectory gateway')
            node.wait(lambda: node.ownership == 1, 3, 'unlocked Position ownership')
            for number in range(2):
                if number == 1:
                    if full:
                        node.joy_wrist = 0.0
                        node.wait(lambda: node.speeds[4] == 0, 3, 'wrist neutral')
                    locked = Bool(); locked.data = True; node.lock.publish(locked)
                    node.wait(lambda: node.ownership == 2, 5, 'locked Position handoff')
                    if full: node.joy_wrist = 0.5
                elif full:
                    node.joy_wrist = 0.5
                names = ['base_joint', 'shoulder_joint', 'elbow_joint', 'yaw_joint', 'pitch_joint', 'roll_joint']
                goal = FollowJointTrajectory.Goal()
                goal.trajectory.joint_names = names[:(6 if number else 3)] if full else names[:1]
                starts = [node.counts[i + 1] * (2 * math.pi / 16384.0) for i in range(len(goal.trajectory.joint_names))]
                first = JointTrajectoryPoint(); first.positions = starts
                last = JointTrajectoryPoint(); last.positions = [min(start + 0.015, 0.08) for start in starts]; last.time_from_start.sec = 3
                goal.trajectory.points = [first, last]
                goal_future = node.action.send_goal_async(goal)
                node.wait(goal_future.done, 5, 'trajectory goal response')
                handle = goal_future.result(); assert handle.accepted, 'trajectory rejected'
                result_future = handle.get_result_async()
                node.wait(result_future.done, 12, 'trajectory result')
                result = result_future.result()
                assert result.status == 4 and result.result.error_code == 0, f'trajectory failed: {result}'
                if full and number == 0:
                    assert node.observed_wrist_during_trajectory, 'no direct wrist motion during proximal trajectory'
                if full and number == 1:
                    assert not node.unexpected_locked_wrist_motion, 'direct wrist motion in locked Position'
            node.joy_wrist = 0.0
            message.data = 'MANUAL'; node.mode.publish(message)
            node.wait(lambda: node.fma is not None and node.fma.arm.confirmed == 'MANUAL', 8, 'return to Manual')
            message.data = 'POSITION'; node.mode.publish(message)
            node.wait(lambda: node.fma is not None and node.fma.arm.confirmed == 'POSITION', 8, 'second Position confirmation')
            node.wait(lambda: node.ownership == 2, 3, 'locked watchdog ownership')
            goal = FollowJointTrajectory.Goal()
            names = ['base_joint', 'shoulder_joint', 'elbow_joint', 'yaw_joint', 'pitch_joint', 'roll_joint']
            goal.trajectory.joint_names = names if full else names[:1]
            starts = [node.counts[i + 1] * (2 * math.pi / 16384.0) for i in range(len(goal.trajectory.joint_names))]
            first = JointTrajectoryPoint(); first.positions = starts
            last = JointTrajectoryPoint(); last.positions = [min(start + 0.01, 0.08) for start in starts]; last.time_from_start.sec = 6
            goal.trajectory.points = [first, last]
            pending = node.action.send_goal_async(goal)
            node.wait(pending.done, 5, 'watchdog trajectory response')
            assert pending.result().accepted, 'watchdog trajectory rejected'
            node.wait(lambda: node.status is not None and not node.status.motion_inhibited, 5, 'watchdog trajectory gate')
            os.killpg(children[1].pid, signal.SIGTERM)
            node.wait(lambda: node.status is not None and node.status.control_owner == 0 and
                      'ownership lease expired' in node.status.reason, 5, 'lost Rover Control inhibition')
            node.wait(lambda: node.speed == 0, 2, 'stop after lost Rover Control')
            print(f'PASS: {len(node.counts)}-joint real controller, simulated CAN, locked/unlocked transitions, trajectories and Rover Control loss')
        except BaseException:
            log.flush(); print((root / 'process.log').read_text()); raise
        finally:
            for child in children:
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGTERM)
            for child in children:
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL); child.wait()
            log.close(); node.destroy_node(); rclpy.shutdown()


if __name__ == '__main__':
    main()
