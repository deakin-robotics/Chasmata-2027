"""Verify MoveIt bridge status when the rover rejects or aborts an action."""
import time
import unittest

import rclpy
from geometry_msgs.msg import PoseStamped
from rclpy.node import Node
from std_msgs.msg import String
from telemetry_interfaces.msg import ArmMoveItStatus
from tf2_ros import Buffer, TransformListener


class RoverFailureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rclpy.init()
        cls.node = Node("basestation_failure_test_client")
        cls.status = []
        cls.node.create_subscription(ArmMoveItStatus, "/arm/moveit/status", lambda msg: cls.status.append(msg), 10)
        cls.behaviour = cls.node.create_publisher(String, "/test/trajectory_behaviour", 10)
        cls.target = cls.node.create_publisher(PoseStamped, "/arm/target_pose", 10)
        cls.tf = Buffer()
        cls.listener = TransformListener(cls.tf, cls.node)

    @classmethod
    def tearDownClass(cls):
        cls.node.destroy_node()
        rclpy.shutdown()

    def wait(self, predicate, seconds=40):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            rclpy.spin_once(self.node, timeout_sec=0.05)
            if predicate():
                return True
        return False

    def request(self, behaviour, request_id):
        self.assertTrue(self.wait(lambda: self.behaviour.get_subscription_count() and self.target.get_subscription_count()))
        self.assertTrue(self.wait(lambda: self.tf.can_transform("base_link", "j4_pivot_link", rclpy.time.Time())))
        self.behaviour.publish(String(data=behaviour))
        self.wait(lambda: False, 0.5)
        pivot = self.tf.lookup_transform("base_link", "j4_pivot_link", rclpy.time.Time()).transform
        target = PoseStamped()
        target.header.frame_id = "base_link"
        target.header.stamp.nanosec = request_id
        target.pose.position.x = pivot.translation.x
        target.pose.position.y = pivot.translation.y
        target.pose.position.z = pivot.translation.z
        target.pose.orientation.w = 1.0
        self.target.publish(target)
        self.assertTrue(self.wait(lambda: any(s.request_id == request_id and s.state == "FAILED" for s in self.status)))
        return [s for s in self.status if s.request_id == request_id]

    # The bridge reports a rejected rover trajectory goal without confirming execution.
    def test_rejected_goal(self):
        states = self.request("reject", 201)
        self.assertIn("rejected", states[-1].message.lower())
        self.assertNotIn("EXECUTING", [s.state for s in states])

    # The bridge reports a rover execution abort after the goal was accepted.
    def test_execution_failure(self):
        states = self.request("abort", 202)
        self.assertIn("EXECUTING", [s.state for s in states])
        self.assertIn("failed", states[-1].message.lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
