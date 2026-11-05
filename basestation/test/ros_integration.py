"""Integration checks against the launched MoveIt bridge and mock rover."""

import math
import time
import unittest

import rclpy
from control_msgs.action import FollowJointTrajectory
from geometry_msgs.msg import PoseStamped
from rclpy.node import Node
from sensor_msgs.msg import JointState
from std_msgs.msg import Bool, Empty
from telemetry_interfaces.msg import ArmMoveItStatus
from tf2_ros import Buffer, TransformListener


class BaseStationRosTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rclpy.init()
        cls.node = Node("basestation_suite_client")
        cls.heartbeats = []
        cls.joints = []
        cls.status = []
        cls.feedback = []
        cls.node.create_subscription(Empty, "/basestation/heartbeat", lambda msg: cls.heartbeats.append(time.monotonic()), 10)
        cls.node.create_subscription(JointState, "/arm/joint_states", lambda msg: cls.joints.append(msg), 10)
        cls.node.create_subscription(ArmMoveItStatus, "/arm/moveit/status", lambda msg: cls.status.append(msg), 10)
        cls.node.create_subscription(FollowJointTrajectory.Impl.FeedbackMessage,
            "/arm_controller/follow_joint_trajectory/_action/feedback", lambda msg: cls.feedback.append(msg.feedback), 10)
        cls.target = cls.node.create_publisher(PoseStamped, "/arm/target_pose", 10)
        cls.lock = cls.node.create_publisher(Bool, "/arm/orientation_lock", 10)
        cls.joint_command = cls.node.create_publisher(JointState, "/arm/joint_commands", 10)
        cls.tf = Buffer()
        cls.listener = TransformListener(cls.tf, cls.node)

    @classmethod
    def tearDownClass(cls):
        cls.node.destroy_node()
        rclpy.shutdown()

    def wait(self, predicate, seconds=30):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            rclpy.spin_once(self.node, timeout_sec=0.05)
            if predicate():
                return True
        return False

    def make_target(self, request_id):
        self.assertTrue(self.wait(lambda: self.tf.can_transform("base_link", "j4_pivot_link", rclpy.time.Time()) and self.tf.can_transform("base_link", "ee_link", rclpy.time.Time())))
        pivot = self.tf.lookup_transform("base_link", "j4_pivot_link", rclpy.time.Time()).transform
        ee = self.tf.lookup_transform("base_link", "ee_link", rclpy.time.Time()).transform
        target = PoseStamped()
        target.header.frame_id = "base_link"
        target.header.stamp.nanosec = request_id
        target.pose.position.x = pivot.translation.x
        target.pose.position.y = pivot.translation.y
        target.pose.position.z = pivot.translation.z
        target.pose.orientation = ee.rotation
        return target

    # The BaseStation continues publishing heartbeat and receives all six rover joints.
    def test_heartbeat_and_joint_states(self):
        self.assertTrue(self.wait(lambda: len(self.heartbeats) >= 2 and bool(self.joints)))
        self.assertEqual(set(self.joints[-1].name), {"base_joint", "shoulder_joint", "elbow_joint", "yaw_joint", "pitch_joint", "roll_joint"})

    # An unlocked target is planned and executed through the mock trajectory server.
    def test_unlocked_target_status(self):
        self.assertTrue(self.wait(lambda: self.target.get_subscription_count() and self.lock.get_subscription_count()))
        self.lock.publish(Bool(data=False))
        target = self.make_target(101)
        self.target.publish(target)
        self.assertTrue(self.wait(lambda: any(s.request_id == 101 and s.state in ("SUCCEEDED", "FAILED") for s in self.status), 45))
        states = [s.state for s in self.status if s.request_id == 101]
        self.assertIn("PLANNING", states)
        self.assertIn("EXECUTING", states)
        self.assertIn("SUCCEEDED", states)
        self.assertTrue(any(set(f.joint_names) == {"base_joint", "shoulder_joint", "elbow_joint"} for f in self.feedback))

    # A locked target executes a full six-joint trajectory with the current orientation.
    def test_locked_target_status(self):
        self.assertTrue(self.wait(lambda: self.target.get_subscription_count() and self.lock.get_subscription_count()))
        target = self.make_target(102)
        self.lock.publish(Bool(data=True))
        self.wait(lambda: False, 0.2)
        self.target.publish(target)
        self.assertTrue(self.wait(lambda: any(s.request_id == 102 and s.state in ("SUCCEEDED", "FAILED") for s in self.status), 45))
        states = [s.state for s in self.status if s.request_id == 102]
        self.assertIn("PLANNING", states)
        self.assertIn("EXECUTING", states)
        self.assertIn("SUCCEEDED", states)
        self.assertTrue(any(set(f.joint_names) == {"base_joint", "shoulder_joint", "elbow_joint", "yaw_joint", "pitch_joint", "roll_joint"} for f in self.feedback))
        self.wait(lambda: False, 0.2)
        actual = self.tf.lookup_transform("base_link", "ee_link", rclpy.time.Time()).transform.rotation
        expected = target.pose.orientation
        dot = abs(actual.x * expected.x + actual.y * expected.y + actual.z * expected.z + actual.w * expected.w)
        self.assertGreaterEqual(dot, math.cos(0.03 / 2))

    # A clearly unreachable pivot reports failure against the original request ID.
    def test_unreachable_target_reports_failure(self):
        self.assertTrue(self.wait(lambda: self.target.get_subscription_count()))
        target = self.make_target(103)
        target.pose.position.x = 100.0
        self.target.publish(target)
        self.assertTrue(self.wait(lambda: any(s.request_id == 103 and s.state == "FAILED" for s in self.status), 45))

    def reachable_motion_target(self, request_id):
        self.assertTrue(self.wait(lambda: self.target.get_subscription_count() and self.lock.get_subscription_count() and self.joint_command.get_subscription_count()))
        self.lock.publish(Bool(data=False))
        self.wait(lambda: False, 0.2)
        initial = JointState(name=["base_joint", "shoulder_joint", "elbow_joint"], position=[0.0, 0.5, 0.5])
        self.joint_command.publish(initial)
        self.assertTrue(self.wait(lambda: self.joints and abs(self.joints[-1].position[1] - 0.5) < 0.001))
        self.wait(lambda: False, 0.3)
        self.joint_command.publish(JointState(name=["base_joint"], position=[0.5]))
        self.assertTrue(self.wait(lambda: abs(self.joints[-1].position[0] - 0.5) < 0.001))
        self.wait(lambda: False, 0.3)
        target = self.make_target(request_id)
        self.joint_command.publish(initial)
        self.assertTrue(self.wait(lambda: abs(self.joints[-1].position[0]) < 0.001))
        self.wait(lambda: False, 0.3)
        return target

    # A newer target cancels the active trajectory and is planned from current feedback.
    def test_new_target_cancels_active_trajectory(self):
        target = self.reachable_motion_target(104)
        self.target.publish(target)
        self.assertTrue(self.wait(lambda: any(s.request_id == 104 and s.state == "EXECUTING" for s in self.status), 45))
        self.assertTrue(self.wait(lambda: self.joints and self.joints[-1].position[0] > 0.05, 10))
        measured_base = self.joints[-1].position[0]
        replacement = self.make_target(105)
        self.target.publish(replacement)
        self.assertTrue(self.wait(lambda: any(s.request_id == 104 and s.state == "CANCELED" for s in self.status), 20))
        self.assertTrue(self.wait(lambda: any(s.request_id == 105 and s.state == "SUCCEEDED" for s in self.status), 45))
        self.assertAlmostEqual(self.joints[-1].position[0], measured_base, delta=0.08)

    # Changing orientation lock cancels the active trajectory and replans the target.
    def test_orientation_change_cancels_and_replans(self):
        target = self.reachable_motion_target(106)
        self.target.publish(target)
        self.assertTrue(self.wait(lambda: any(s.request_id == 106 and s.state == "EXECUTING" for s in self.status), 45))
        self.lock.publish(Bool(data=True))
        self.assertTrue(self.wait(lambda: any(s.request_id == 106 and s.state == "CANCELED" for s in self.status), 20))
        self.assertTrue(self.wait(lambda: sum(s.request_id == 106 and s.state == "PLANNING" for s in self.status) >= 2, 20))
        self.assertTrue(self.wait(lambda: any(s.request_id == 106 and s.state == "SUCCEEDED" for s in self.status), 45))


if __name__ == "__main__":
    unittest.main(verbosity=2)
