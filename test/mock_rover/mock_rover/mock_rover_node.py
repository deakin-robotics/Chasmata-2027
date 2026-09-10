"""ROS 2 mock rover used for GUI integration testing."""

import json
import math
import time
from typing import Dict, Optional, Tuple

import rclpy
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from sensor_msgs.msg import JointState
from std_msgs.msg import String

from .simulation import JointSimulator


JOINT_NAMES = (
    'base_joint',
    'shoulder_joint',
    'elbow_joint',
    'yaw_joint',
    'pitch_joint',
    'roll_joint',
)

# These match the current GUI URDF and the rover driver's documented ranges.
JOINT_LIMITS: Dict[str, Tuple[float, float]] = {
    'base_joint': (math.radians(-185.0), math.radians(185.0)),
    'shoulder_joint': (math.radians(-5.0), math.radians(185.0)),
    'elbow_joint': (math.radians(-5.0), math.radians(275.0)),
    'yaw_joint': (math.radians(-95.0), math.radians(185.0)),
    'pitch_joint': (math.radians(-5.0), math.radians(215.0)),
    'roll_joint': (math.radians(-185.0), math.radians(185.0)),
}

JOINT_COMMAND_TOPIC = '/joint_commands'
JOINT_STATE_TOPIC = '/joint_states'
DRIVE_MODE_REQUEST_TOPIC = '/fma/drive/request'
ARM_MODE_REQUEST_TOPIC = '/fma/arm/request'
FMA_STATE_TOPIC = '/fma/state'

DRIVE_MODES = {'MANUAL', 'VELOCITY', 'MANAGED'}
ARM_MODES = {'MANUAL', 'POSITION', 'MANAGED', 'STOWED'}


class MockRoverNode(Node):
    """Accepts GUI requests and publishes deterministic rover feedback."""

    def __init__(self) -> None:
        super().__init__('mock_rover')

        self.declare_parameter('joint_speed_rad_s', 1.0)
        self.declare_parameter('publish_rate_hz', 20.0)
        self.declare_parameter('mode_ack_delay_ms', 150.0)

        joint_speed = float(self.get_parameter('joint_speed_rad_s').value)
        publish_rate = max(float(self.get_parameter('publish_rate_hz').value), 1.0)
        self.mode_ack_delay_seconds = max(
            float(self.get_parameter('mode_ack_delay_ms').value) / 1000.0,
            0.0,
        )

        self.joints = JointSimulator(JOINT_NAMES, JOINT_LIMITS, joint_speed)
        self.drive_mode: Optional[str] = None
        self.arm_mode: Optional[str] = None
        self.pending_modes: Dict[str, Optional[Tuple[str, float]]] = {
            'drive': None,
            'arm': None,
        }
        self.rejected_modes: Dict[str, Optional[str]] = {
            'drive': None,
            'arm': None,
        }
        self.rejection_clear_times: Dict[str, Optional[float]] = {
            'drive': None,
            'arm': None,
        }
        self.sequence = 0
        self.last_tick = time.monotonic()
        self.last_fma_publish = 0.0

        fma_qos = QoSProfile(depth=1)
        fma_qos.reliability = ReliabilityPolicy.RELIABLE
        fma_qos.durability = DurabilityPolicy.TRANSIENT_LOCAL

        self.fma_publisher = self.create_publisher(String, FMA_STATE_TOPIC, fma_qos)
        self.joint_state_publisher = self.create_publisher(JointState, JOINT_STATE_TOPIC, 10)

        self.create_subscription(
            JointState,
            JOINT_COMMAND_TOPIC,
            self.joint_command_callback,
            10,
        )
        self.create_subscription(
            String,
            DRIVE_MODE_REQUEST_TOPIC,
            lambda message: self.mode_request_callback('drive', message.data),
            10,
        )
        self.create_subscription(
            String,
            ARM_MODE_REQUEST_TOPIC,
            lambda message: self.mode_request_callback('arm', message.data),
            10,
        )

        self.create_timer(1.0 / publish_rate, self.tick)
        self.publish_fma()
        self.publish_joint_state()

        self.get_logger().info('Mock rover ready')
        self.get_logger().info('ROSbridge should expose ws://localhost:9090')

    def mode_request_callback(self, subsystem: str, raw_mode: str) -> None:
        mode = raw_mode.strip().upper()
        valid_modes = DRIVE_MODES if subsystem == 'drive' else ARM_MODES

        if mode not in valid_modes:
            self.rejected_modes[subsystem] = mode
            self.pending_modes[subsystem] = None
            self.rejection_clear_times[subsystem] = time.monotonic() + 0.5
            self.publish_fma()
            self.get_logger().warn(f'Rejected {subsystem} mode request: {mode}')
            return

        self.rejected_modes[subsystem] = None
        self.rejection_clear_times[subsystem] = None
        self.pending_modes[subsystem] = (
            mode,
            time.monotonic() + self.mode_ack_delay_seconds,
        )
        self.publish_fma()
        self.get_logger().info(f'Pending {subsystem} mode request: {mode}')

    def joint_command_callback(self, message: JointState) -> None:
        if not message.position:
            self.get_logger().warn('Ignored an empty joint command')
            return

        if message.name:
            if len(message.name) != len(message.position):
                self.get_logger().warn('Ignored a joint command with mismatched names and positions')
                return
            joint_values = dict(zip(message.name, message.position))
        elif len(message.position) == len(JOINT_NAMES):
            joint_values = dict(zip(JOINT_NAMES, message.position))
        else:
            self.get_logger().warn('Ignored an unnamed command with the wrong joint count')
            return

        accepted_values = self.joints.set_target(joint_values)
        unknown_joints = set(joint_values) - set(JOINT_NAMES)
        if unknown_joints:
            self.get_logger().warn(f'Ignored unknown joints: {sorted(unknown_joints)}')
        if accepted_values:
            self.get_logger().debug(f'Accepted joint target: {accepted_values}')

    def tick(self) -> None:
        now = time.monotonic()
        elapsed = min(max(now - self.last_tick, 0.0), 0.25)
        self.last_tick = now

        self.process_mode_requests(now)
        self.clear_expired_rejections(now)
        self.joints.step(elapsed)
        self.publish_joint_state()

        if now - self.last_fma_publish >= 1.0:
            self.publish_fma()

    def process_mode_requests(self, now: float) -> None:
        for subsystem, pending in self.pending_modes.items():
            if pending is None or pending[1] > now:
                continue

            mode = pending[0]
            if subsystem == 'drive':
                self.drive_mode = mode
            else:
                self.arm_mode = mode

            self.pending_modes[subsystem] = None
            self.publish_fma()
            self.get_logger().info(f'Confirmed {subsystem} mode: {mode}')

    def clear_expired_rejections(self, now: float) -> None:
        changed = False
        for subsystem, clear_time in self.rejection_clear_times.items():
            if clear_time is not None and clear_time <= now:
                self.rejected_modes[subsystem] = None
                self.rejection_clear_times[subsystem] = None
                changed = True

        if changed:
            self.publish_fma()

    def publish_fma(self) -> None:
        self.sequence += 1
        payload = {
            'schema': 'dcr/fma-state/v1',
            'sequence': self.sequence,
            'drive': self.mode_state('drive', self.drive_mode),
            'arm': self.mode_state('arm', self.arm_mode),
            'law': 'NORMAL',
            'system': 'GOOD',
            'link': 'GOOD',
            'gimbal_priority': None,
        }
        message = String()
        message.data = json.dumps(payload, separators=(',', ':'))
        self.fma_publisher.publish(message)
        self.last_fma_publish = time.monotonic()

    def mode_state(self, subsystem: str, confirmed: Optional[str]) -> Dict[str, Optional[str]]:
        pending = self.pending_modes[subsystem]
        return {
            'confirmed': confirmed,
            'pending': pending[0] if pending is not None else None,
            'rejected': self.rejected_modes[subsystem],
        }

    def publish_joint_state(self) -> None:
        message = JointState()
        message.header.stamp = self.get_clock().now().to_msg()
        message.name = list(JOINT_NAMES)
        positions = self.joints.positions()
        velocities = self.joints.velocities()
        message.position = [positions[name] for name in JOINT_NAMES]
        message.velocity = [velocities[name] for name in JOINT_NAMES]
        self.joint_state_publisher.publish(message)


def main(args=None) -> None:
    rclpy.init(args=args)
    node = MockRoverNode()

    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
