"""ROS 2 mock rover used for GUI integration testing."""

import json
import math
import time
import threading
from typing import Dict, Optional, Tuple

from control_msgs.action import FollowJointTrajectory
import rclpy
from rclpy.action import ActionServer, CancelResponse, GoalResponse
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from sensor_msgs.msg import JointState, Joy
from std_msgs.msg import Bool, String

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
ORIENTATION_LOCK_TOPIC = '/arm/orientation_lock'
DRIVE_MODE_REQUEST_TOPIC = '/fma/drive/request'
ARM_MODE_REQUEST_TOPIC = '/fma/arm/request'
LAW_MODE_REQUEST_TOPIC = '/fma/law/request'
GIMBAL_PRIORITY_REQUEST_TOPIC = '/fma/gimbal/request'
FMA_STATE_TOPIC = '/fma/state'

DRIVE_TRIGGER_AXES = (4, 5)
ARM_TRIGGER_AXES = (8, 9)
PROXIMAL_JOINT_NAMES = ('base_joint', 'shoulder_joint', 'elbow_joint')
WRIST_JOINT_NAMES = ('yaw_joint', 'pitch_joint', 'roll_joint')
POSITION_WRIST_SPEED_RAD_S = 0.5
POSITION_INPUT_PERIOD_SECONDS = 0.02

DRIVE_MODES = {'MANUAL', 'VELOCITY', 'MANAGED'}
ARM_MODES = {'MANUAL', 'POSITION', 'MANAGED', 'STOWED'}
LAW_MODES = {'NORMAL', 'ALTERNATE', 'DIRECT'}
LAW_REQUESTS = {'DIRECT', 'RESTORE'}
GIMBAL_PRIORITY_OWNERS = {'DRIVER', 'ARM OPS'}


class MockRoverNode(Node):
    """Accepts GUI requests and publishes deterministic rover feedback."""

    def __init__(self) -> None:
        super().__init__('mock_rover')

        self.declare_parameter('publish_rate_hz', 10.0)
        self.declare_parameter('mode_ack_delay_ms', 150.0)

        publish_rate = max(float(self.get_parameter('publish_rate_hz').value), 1.0)
        self.mode_ack_delay_seconds = max(
            float(self.get_parameter('mode_ack_delay_ms').value) / 1000.0,
            0.0,
        )

        # The simulator keeps the rover-side limit checks and state shape, while
        # the action server models timed trajectory execution.
        self.joints = JointSimulator(JOINT_NAMES, JOINT_LIMITS, max_speed_rad_s=1.0)
        self.trajectory_execution_lock = threading.Lock()
        self.trajectory_callback_group = ReentrantCallbackGroup()
        self.drive_mode: Optional[str] = None
        self.arm_mode: Optional[str] = None
        self.orientation_locked = False
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
            callback_group=self.trajectory_callback_group,
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
            Bool,
            ORIENTATION_LOCK_TOPIC,
            self.orientation_lock_callback,
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

    def execute_trajectory(self, goal_handle):
        with self.trajectory_execution_lock:
            return self._execute_trajectory(goal_handle)

    def _execute_trajectory(self, goal_handle):
        result = FollowJointTrajectory.Result()
        trajectory = goal_handle.request.trajectory
        joint_names = list(trajectory.joint_names)

        joint_name_set = set(joint_names)
        valid_partial_goal = joint_name_set.issubset(PROXIMAL_JOINT_NAMES)
        valid_full_goal = joint_name_set == set(JOINT_NAMES)
        if (
            len(joint_name_set) != len(joint_names) or
            not (valid_partial_goal or valid_full_goal) or
            (self.orientation_locked and not valid_full_goal)
        ):
            result.error_code = FollowJointTrajectory.Result.INVALID_JOINTS
            result.error_string = (
                'The trajectory must contain J1-J3 when orientation is unlocked '
                'or all six joints when orientation is locked.'
            )
            goal_handle.abort()
            return result

        previous_time = 0.0
        for point in trajectory.points:
            point_time = float(point.time_from_start.sec) + float(point.time_from_start.nanosec) / 1e9
            if point_time < previous_time or len(point.positions) != len(joint_names):
                result.error_code = FollowJointTrajectory.Result.INVALID_GOAL
                result.error_string = 'The trajectory points have invalid timing or positions.'
                goal_handle.abort()
                return result

            point_values = [float(position) for position in point.positions]
            if not all(math.isfinite(position) for position in point_values):
                result.error_code = FollowJointTrajectory.Result.INVALID_GOAL
                result.error_string = 'The trajectory contains non-finite positions.'
                goal_handle.abort()
                return result

            for joint_name, position in zip(joint_names, point_values):
                lower, upper = JOINT_LIMITS[joint_name]
                if position < lower or position > upper:
                    result.error_code = FollowJointTrajectory.Result.INVALID_GOAL
                    result.error_string = f'Trajectory exceeds the limit for {joint_name}.'
                    goal_handle.abort()
                    return result

            previous_time = point_time

        if previous_time <= 0.0:
            result.error_code = FollowJointTrajectory.Result.INVALID_GOAL
            result.error_string = 'The trajectory must have a positive duration.'
            goal_handle.abort()
            return result

        if goal_handle.is_cancel_requested:
            goal_handle.canceled()
            result.error_code = FollowJointTrajectory.Result.INVALID_GOAL
            result.error_string = 'The trajectory was cancelled before execution.'
            return result

        start_positions = self.joints.positions()
        elapsed_start = time.monotonic()
        previous_point_time = 0.0
        previous_positions = [start_positions[name] for name in joint_names]

        for point in trajectory.points:
            point_time = float(point.time_from_start.sec) + float(point.time_from_start.nanosec) / 1e9
            target_positions = [float(position) for position in point.positions]
            segment_duration = point_time - previous_point_time

            while True:
                if goal_handle.is_cancel_requested:
                    goal_handle.canceled()
                    result.error_code = FollowJointTrajectory.Result.INVALID_GOAL
                    result.error_string = 'The trajectory was cancelled during execution.'
                    return result

                elapsed = time.monotonic() - elapsed_start
                if segment_duration <= 0.0:
                    fraction = 1.0
                else:
                    fraction = min(
                        max((elapsed - previous_point_time) / segment_duration, 0.0),
                        1.0,
                    )

                positions = [
                    start + (target - start) * fraction
                    for start, target in zip(previous_positions, target_positions)
                ]
                velocities = {
                    name: (
                        (target - start) / segment_duration
                        if segment_duration > 0.0
                        else 0.0
                    )
                    for name, start, target in zip(
                        joint_names,
                        previous_positions,
                        target_positions,
                    )
                }
                self.joints.set_actual_positions(
                    dict(zip(joint_names, positions)),
                    velocities,
                )
                self.publish_joint_state()

                feedback = FollowJointTrajectory.Feedback()
                feedback.joint_names = joint_names
                feedback.actual.positions = positions
                feedback.actual.velocities = [velocities[name] for name in joint_names]
                goal_handle.publish_feedback(feedback)

                if fraction >= 1.0:
                    break

                time.sleep(0.02)

            previous_point_time = point_time
            previous_positions = target_positions

        self.joints.set_actual_positions(
            dict(zip(joint_names, previous_positions)),
            {name: 0.0 for name in joint_names},
        )
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

        if subsystem == 'arm' and self.arm_mode == 'POSITION' and not self.orientation_locked:
            self.apply_position_wrist_command(message)

    def orientation_lock_callback(self, message: Bool) -> None:
        self.orientation_locked = bool(message.data)
        self.get_logger().info(
            f'Arm orientation is now {"LOCKED" if self.orientation_locked else "UNLOCKED"}'
        )

    def apply_position_wrist_command(self, message: Joy) -> None:
        dpad_yaw = float(message.axes[6])
        dpad_pitch = float(message.axes[7])
        roll = float(message.axes[9]) - float(message.axes[8])
        current = self.joints.positions()
        deltas = {
            'yaw_joint': dpad_yaw,
            'pitch_joint': dpad_pitch,
            'roll_joint': roll,
        }
        targets = {
            name: current[name] + value * POSITION_WRIST_SPEED_RAD_S * POSITION_INPUT_PERIOD_SECONDS
            for name, value in deltas.items()
            if value != 0.0
        }
        if targets:
            accepted = self.joints.set_target_immediately(targets)
            if accepted:
                self.publish_joint_state()

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
    executor = MultiThreadedExecutor(num_threads=4)
    executor.add_node(node)

    try:
        executor.spin()
    except KeyboardInterrupt:
        pass
    finally:
        executor.shutdown()
        node.destroy_node()
        rclpy.shutdown()
