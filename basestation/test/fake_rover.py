"""Publish measured joints and provide configurable trajectory outcomes for tests."""
import time

import rclpy
from control_msgs.action import FollowJointTrajectory
from rclpy.action import ActionServer, CancelResponse, GoalResponse
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from sensor_msgs.msg import JointState
from std_msgs.msg import Bool, String, UInt8


class FakeRover(Node):
    def __init__(self):
        super().__init__("basestation_test_rover")
        self.behaviour = "abort"
        self.locked = False
        self.ownership = self.create_publisher(UInt8, "/arm/position/ownership", 10)
        self.create_subscription(Bool, "/arm/orientation_lock", self.set_lock, 10)
        self.joints = self.create_publisher(JointState, "/arm/joint_states", 10)
        self.create_timer(0.1, self.publish_joints)
        self.create_subscription(String, "/test/trajectory_behaviour", self.set_behaviour, 10)
        self.server = ActionServer(self, FollowJointTrajectory, "/arm_controller/follow_joint_trajectory",
                                   self.execute, goal_callback=self.goal, cancel_callback=self.cancel,
                                   callback_group=ReentrantCallbackGroup())

    def set_lock(self, message):
        self.locked = message.data

    def set_behaviour(self, message):
        self.behaviour = message.data

    def publish_joints(self):
        message = JointState()
        message.header.stamp = self.get_clock().now().to_msg()
        message.name = ["base_joint", "shoulder_joint", "elbow_joint", "yaw_joint", "pitch_joint", "roll_joint"]
        message.position = [0.0, 0.5, 0.5, 0.0, 0.0, 0.0]
        self.joints.publish(message)
        ownership = UInt8()
        ownership.data = 2 if self.locked else 1
        self.ownership.publish(ownership)

    def goal(self, request):
        return GoalResponse.REJECT if self.behaviour == "reject" else GoalResponse.ACCEPT

    def cancel(self, goal):
        return CancelResponse.ACCEPT

    def execute(self, goal):
        time.sleep(0.1)
        result = FollowJointTrajectory.Result()
        result.error_code = FollowJointTrajectory.Result.INVALID_GOAL
        goal.abort()
        return result


rclpy.init()
node = FakeRover()
executor = MultiThreadedExecutor()
executor.add_node(node)
try:
    executor.spin()
finally:
    executor.shutdown()
    node.destroy_node()
    rclpy.shutdown()
