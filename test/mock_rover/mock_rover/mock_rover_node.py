"""ROS 2 mock rover used for GUI integration testing."""

import json
import math
import time
from typing import Dict, Optional, Tuple

from control_msgs.action import FollowJointTrajectory
import rclpy
from rclpy.action import ActionServer, CancelResponse, GoalResponse
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from sensor_msgs.msg import JointState, Joy
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
ARM_TRAJECTORY_ACTION = '/arm_controller/follow_joint_trajectory'
JOINT_STATE_TOPIC = '/joint_states'
DRIVE_JOY_TOPIC = '/joy'
ARM_JOY_TOPIC = '/arm/joy'
DRIVE_MODE_REQUEST_TOPIC = '/fma/drive/request'
ARM_MODE_REQUEST_TOPIC = '/fma/arm/request'
LAW_MODE_REQUEST_TOPIC = '/fma/law/request'
GIMBAL_PRIORITY_REQUEST_TOPIC = '/fma/gimbal/request'
FMA_STATE_TOPIC = '/fma/state'

DRIVE_TRIGGER_AXES = (4, 5)
ARM_TRIGGER_AXES = (8, 9)

DRIVE_MODES = {'MANUAL', 'VELOCITY', 'MANAGED'}
ARM_MODES = {'MANUAL', 'POSITION', 'MANAGED', 'STOWED'}
LAW_MODES = {'NORMAL', 'ALTERNATE', 'DIRECT'}
LAW_REQUESTS = {'DIRECT', 'RESTORE'}
GIMBAL_PRIORITY_OWNERS = {'DRIVER', 'ARM OPS'}


class MockRoverNode(Node):
    """Accepts GUI requests and publishes deterministic rover feedback."""

    def __init__(self) -> None:
        super().__init__('mock_rover')

        self.declare_parameter('publish_rate_hz', 20.0)
        self.declare_parameter('mode_ack_delay_ms', 150.0)

        publish_rate = max(float(self.get_parameter('publish_rate_hz').value), 1.0)
        self.mode_ack_delay_seconds = max(
            float(self.get_parameter('mode_ack_delay_ms').value) / 1000.0,
            0.0,
        )

        # The mock is an immediate command/telemetry loop. The simulator keeps
        # the rover-side limit checks and state shape, while accepted commands
        # are reflected in /joint_states without modelling motor dynamics.
        self.joints = JointSimulator(JOINT_NAMES, JOINT_LIMITS, max_speed_rad_s=1.0)
        self.drive_mode: Optional[str] = None
        self.arm_mode: Optional[str] = None
        self.law_mode = 'NORMAL'
        self.law_before_override: Optional[str] = None
        self.pending_law: Optional[Tuple[str, float]] = None
        self.gimbal_priority: Optional[str] = None
        self.pending_gimbal_priority: Optional[Tuple[str, float]] = None
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
        self.last_fma_publish = 0.0

        fma_qos = QoSProfile(depth=1)
        fma_qos.reliability = ReliabilityPolicy.RELIABLE
        fma_qos.durability = DurabilityPolicy.TRANSIENT_LOCAL

        self.fma_publisher = self.create_publisher(String, FMA_STATE_TOPIC, fma_qos)
        self.joint_state_publisher = self.create_publisher(JointState, JOINT_STATE_TOPIC, 10)
        self.trajectory_action_server = ActionServer(
            self,
            FollowJointTrajectory,
            ARM_TRAJECTORY_ACTION,
            execute_callback=self.execute_trajectory,
            goal_callback=self.trajectory_goal_callback,
            cancel_callback=self.trajectory_cancel_callback,
        )

        self.create_subscription(
            JointState,
            JOINT_COMMAND_TOPIC,
            self.joint_command_callback,
            10,
        )
        self.create_subscription(
            Joy,
            DRIVE_JOY_TOPIC,
            lambda message: self.joy_callback('drive', message, DRIVE_TRIGGER_AXES),
            10,
        )
        self.create_subscription(
            Joy,
            ARM_JOY_TOPIC,
            lambda message: self.joy_callback('arm', message, ARM_TRIGGER_AXES),
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
        self.create_subscription(
            String,
            LAW_MODE_REQUEST_TOPIC,
            self.law_mode_request_callback,
            10,
        )
        self.create_subscription(
            String,
            GIMBAL_PRIORITY_REQUEST_TOPIC,
            self.gimbal_priority_request_callback,
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

        accepted_values = self.joints.set_target_immediately(joint_values)
        unknown_joints = set(joint_values) - set(JOINT_NAMES)
        if unknown_joints:
            self.get_logger().warn(f'Ignored unknown joints: {sorted(unknown_joints)}')
        if accepted_values:
            self.get_logger().debug(f'Accepted joint target: {accepted_values}')
            self.publish_joint_state()

    def trajectory_goal_callback(self, goal_request) -> GoalResponse:
        if not goal_request.trajectory.joint_names or not goal_request.trajectory.points:
            return GoalResponse.REJECT

        return GoalResponse.ACCEPT

    def trajectory_cancel_callback(self, _goal_handle) -> CancelResponse:
        return CancelResponse.ACCEPT

    async def execute_trajectory(self, goal_handle):
        result = FollowJointTrajectory.Result()
        trajectory = goal_handle.request.trajectory
        joint_names = list(trajectory.joint_names)

        if len(joint_names) != len(JOINT_NAMES) or set(joint_names) != set(JOINT_NAMES):
            result.error_code = FollowJointTrajectory.Result.INVALID_JOINTS
            result.error_string = 'The trajectory must contain the six arm joints.'
            goal_handle.abort()
            return result

        final_point = trajectory.points[-1]
        if len(final_point.positions) != len(joint_names) or not all(
            math.isfinite(float(position)) for position in final_point.positions
        ):
            result.error_code = FollowJointTrajectory.Result.INVALID_GOAL
            result.error_string = 'The trajectory final point has invalid positions.'
            goal_handle.abort()
            return result

        if goal_handle.is_cancel_requested:
            goal_handle.canceled()
            result.error_code = FollowJointTrajectory.Result.INVALID_GOAL
            result.error_string = 'The trajectory was cancelled before execution.'
            return result

        accepted_values = self.joints.set_target_immediately(
            dict(zip(joint_names, final_point.positions))
        )
        if len(accepted_values) != len(JOINT_NAMES):
            result.error_code = FollowJointTrajectory.Result.INVALID_GOAL
            result.error_string = 'The trajectory contained an unknown arm joint.'
            goal_handle.abort()
            return result

        self.publish_joint_state()
        goal_handle.succeed()
        result.error_code = FollowJointTrajectory.Result.SUCCESSFUL
        result.error_string = ''
        self.get_logger().info('Executed an arm trajectory through the mock rover')
        return result

    def gimbal_priority_request_callback(self, message: String) -> None:
        owner = message.data.strip().upper()
        if owner not in GIMBAL_PRIORITY_OWNERS:
            self.get_logger().warn(f'Rejected Gimbal priority request: {owner}')
            return

        self.pending_gimbal_priority = (
            owner,
            time.monotonic() + self.mode_ack_delay_seconds,
        )
        self.publish_fma()
        self.get_logger().info(f'Pending Gimbal priority request: {owner}')

    def law_mode_request_callback(self, message: String) -> None:
        request = message.data.strip().upper()
        if request not in LAW_REQUESTS:
            self.get_logger().warn(f'Rejected LAW request: {request}')
            return

        self.pending_law = (
            request,
            time.monotonic() + self.mode_ack_delay_seconds,
        )
        self.publish_fma()
        self.get_logger().info(f'Pending LAW request: {request}')

    def joy_callback(self, subsystem: str, message: Joy, trigger_axes: Tuple[int, int]) -> None:
        if len(message.axes) <= trigger_axes[1]:
            self.get_logger().warn(
                f'Ignored {subsystem} Joy command without LT/RT axes '
                f'{trigger_axes[0]}/{trigger_axes[1]}'
            )
            return

        trigger_values = [float(message.axes[index]) for index in trigger_axes]
        if not all(math.isfinite(value) and 0.0 <= value <= 1.0 for value in trigger_values):
            self.get_logger().warn(
                f'Ignored {subsystem} Joy command with invalid LT/RT values: '
                f'{trigger_values}'
            )
            return

        if any(value not in (0, 1) for value in message.buttons):
            self.get_logger().warn(
                f'Ignored {subsystem} Joy command with non-digital button values'
            )
            return

        self.get_logger().debug(
            f'Accepted {subsystem} Joy command with LT/RT={trigger_values}'
        )

    def tick(self) -> None:
        now = time.monotonic()

        self.process_mode_requests(now)
        self.process_law_request(now)
        self.process_gimbal_priority_request(now)
        self.clear_expired_rejections(now)
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

    def process_law_request(self, now: float) -> None:
        if self.pending_law is None or self.pending_law[1] > now:
            return

        request = self.pending_law[0]
        if request == 'DIRECT' and self.law_mode != 'DIRECT':
            self.law_before_override = self.law_mode
            self.law_mode = 'DIRECT'
        elif request == 'RESTORE' and self.law_mode == 'DIRECT':
            self.law_mode = self.law_before_override or 'NORMAL'
            self.law_before_override = None

        self.pending_law = None
        self.publish_fma()
        self.get_logger().info(f'Confirmed LAW state: {self.law_mode}')

    def process_gimbal_priority_request(self, now: float) -> None:
        if self.pending_gimbal_priority is None or self.pending_gimbal_priority[1] > now:
            return

        self.gimbal_priority = self.pending_gimbal_priority[0]
        self.pending_gimbal_priority = None
        self.publish_fma()
        self.get_logger().info(f'Confirmed Gimbal priority: {self.gimbal_priority}')

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
            'law': {
                'confirmed': self.law_mode,
                'pending': self.pending_law[0] if self.pending_law is not None else None,
                'rejected': None,
            },
            'system': 'GOOD',
            'gimbal_priority': {
                'confirmed': self.gimbal_priority,
                'pending': (
                    self.pending_gimbal_priority[0]
                    if self.pending_gimbal_priority is not None
                    else None
                ),
                'rejected': None,
            },
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
