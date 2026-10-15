"""Rover-primary ECAM combiner and BaseStation failover relay."""

import time

import rclpy
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from std_msgs.msg import Empty
from telemetry_interfaces.msg import EcamAlertSourceSnapshot, EcamAlerts

from .source import EcamAlertSource, SOURCE_TOPIC, ecam_snapshot_qos
from .state import SOURCE_NAMES as VALID_SOURCES, SourceSnapshotStore


COMBINED_TOPIC = '/ecam/alerts'
ROVER_HEARTBEAT_TOPIC = '/rover/heartbeat'
ROVER_TIMEOUT_SECONDS = 3.0
ROVER_HEARTBEAT_LOST = 'ROVER_HEARTBEAT_LOST'


def combined_qos() -> QoSProfile:
    return QoSProfile(
        depth=1,
        reliability=ReliabilityPolicy.RELIABLE,
        durability=DurabilityPolicy.TRANSIENT_LOCAL,
    )


class EcamAlertAggregator(Node):
    """Combines source snapshots on Rover and takes over when Rover is lost."""

    def __init__(
        self,
        role_override: str | None = None,
        timeout_override: float | None = None,
        node_name: str = 'ecam_alert_aggregator',
    ) -> None:
        super().__init__(node_name)
        self.declare_parameter('role', 'rover')
        self.declare_parameter('rover_timeout_seconds', ROVER_TIMEOUT_SECONDS)
        configured_role = (
            role_override
            if role_override is not None
            else self.get_parameter('role').value
        )
        self.role = str(configured_role).strip().lower()
        if self.role not in {'rover', 'basestation'}:
            raise ValueError("role must be either 'rover' or 'basestation'")

        configured_timeout = (
            timeout_override
            if timeout_override is not None
            else self.get_parameter('rover_timeout_seconds').value
        )
        self._timeout_seconds = max(float(configured_timeout), 0.1)
        self._started_at = time.monotonic()
        self._last_rover_heartbeat: float | None = None
        self._rover_alive = False
        self._taking_over = self.role == 'rover'
        self._awaiting_rover_reflection = False
        self._source_state = SourceSnapshotStore()
        self._source_replay_queue: list[str] = []
        self._rover_combined: EcamAlerts | None = None
        self._base_station_alerts = (
            EcamAlertSource(self, 'basestation')
            if self.role == 'basestation'
            else None
        )

        self._source_publisher = self.create_publisher(
            EcamAlertSourceSnapshot,
            SOURCE_TOPIC,
            ecam_snapshot_qos(),
        )
        self._combined_publisher = self.create_publisher(
            EcamAlerts,
            COMBINED_TOPIC,
            combined_qos(),
        )
        self.create_subscription(
            EcamAlertSourceSnapshot,
            SOURCE_TOPIC,
            self._on_source_snapshot,
            ecam_snapshot_qos(),
        )
        self.create_subscription(
            EcamAlerts,
            COMBINED_TOPIC,
            self._on_combined_snapshot,
            combined_qos(),
        )

        if self.role == 'basestation':
            self.create_subscription(
                Empty,
                ROVER_HEARTBEAT_TOPIC,
                self._on_rover_heartbeat,
                QoSProfile(
                    depth=1,
                    reliability=ReliabilityPolicy.RELIABLE,
                    durability=DurabilityPolicy.VOLATILE,
                ),
            )
            self.create_timer(0.1, self._check_rover_liveness)

        self.get_logger().info(f'ECAM aggregator started as {self.role}')

    def _on_source_snapshot(self, message: EcamAlertSourceSnapshot) -> None:
        source = str(message.source)
        if source not in VALID_SOURCES:
            self.get_logger().warning(f'Ignoring unknown ECAM source: {source}')
            return

        timestamp = (int(message.timestamp.sec), int(message.timestamp.nanosec))
        changed = self._source_state.update(source, timestamp, message.active_codes)

        if self.role == 'rover':
            # Publishing even an unchanged replay is the handback acknowledgement.
            self._publish_combined()
        elif self._taking_over and changed:
            if self._awaiting_rover_reflection and source != 'rover':
                self._queue_source_replay(source)
            self._publish_combined()

    def _on_combined_snapshot(self, message: EcamAlerts) -> None:
        if self.role != 'basestation' or message.authority != 'rover':
            return

        self._rover_combined = message
        rover_state = self._store_from_combined(message)
        if self._awaiting_rover_reflection and rover_state.reflects(self._source_state):
            self._awaiting_rover_reflection = False
            self._taking_over = False
            self._source_replay_queue.clear()
            self.get_logger().info('Rover combined snapshot reflects BaseStation source state')

        for snapshot in message.sources:
            source = str(snapshot.source)
            if source not in VALID_SOURCES:
                continue
            timestamp = (int(snapshot.timestamp.sec), int(snapshot.timestamp.nanosec))
            self._source_state.update(source, timestamp, snapshot.active_codes)

    def _store_from_combined(self, message: EcamAlerts) -> SourceSnapshotStore:
        store = SourceSnapshotStore()
        for snapshot in message.sources:
            if snapshot.source not in VALID_SOURCES:
                continue
            store.update(
                str(snapshot.source),
                (int(snapshot.timestamp.sec), int(snapshot.timestamp.nanosec)),
                snapshot.active_codes,
            )
        return store

    def _on_rover_heartbeat(self, _message: Empty) -> None:
        self._last_rover_heartbeat = time.monotonic()

    def _check_rover_liveness(self) -> None:
        now = time.monotonic()
        if self._awaiting_rover_reflection:
            self._publish_next_replay_snapshot()

        if self._last_rover_heartbeat is None:
            if (
                now - self._started_at >= self._timeout_seconds
                and not self._taking_over
            ):
                self._taking_over = True
                self._source_replay_queue.clear()
                self._raise_rover_heartbeat_lost()
                self._publish_combined()
                self.get_logger().warning(
                    'Rover heartbeat not received; BaseStation is combining ECAM state'
                )
            return

        rover_alive = now - self._last_rover_heartbeat < self._timeout_seconds

        if rover_alive == self._rover_alive:
            return

        self._rover_alive = rover_alive
        if rover_alive:
            if self._taking_over:
                self._awaiting_rover_reflection = True
                self._queue_all_non_rover_sources()
                if (
                    self._base_station_alerts is not None
                    and ROVER_HEARTBEAT_LOST
                    in self._base_station_alerts.active_codes
                ):
                    self._base_station_alerts.clear(ROVER_HEARTBEAT_LOST)
                    self._sync_base_station_source_snapshot()
                    self._queue_source_replay('basestation')
                self._publish_combined()
                self.get_logger().info(
                    'Rover heartbeat returned; synchronizing source snapshots'
                )
        else:
            self._awaiting_rover_reflection = False
            self._taking_over = True
            self._source_replay_queue.clear()
            self._raise_rover_heartbeat_lost()
            self._publish_combined()
            self.get_logger().warning('Rover heartbeat lost; BaseStation is combining ECAM state')

    def _raise_rover_heartbeat_lost(self) -> None:
        if self._base_station_alerts is not None:
            self._base_station_alerts.raise_alert(ROVER_HEARTBEAT_LOST)
            self._sync_base_station_source_snapshot()

    def _sync_base_station_source_snapshot(self) -> None:
        if self._base_station_alerts is None:
            return

        self._source_state.update(
            'basestation',
            self._base_station_alerts.last_snapshot_timestamp,
            self._base_station_alerts.active_codes,
        )

    def _queue_all_non_rover_sources(self) -> None:
        self._source_replay_queue = [
            snapshot.source
            for snapshot in self._source_state.snapshots()
            if snapshot.source != 'rover'
        ]

    def _queue_source_replay(self, source: str) -> None:
        if source != 'rover' and source not in self._source_replay_queue:
            self._source_replay_queue.append(source)

    def _publish_next_replay_snapshot(self) -> None:
        if not self._source_replay_queue:
            self._queue_all_non_rover_sources()
        if not self._source_replay_queue:
            return

        # Depth-1 QoS needs paced replay so one source cannot replace another.
        source = self._source_replay_queue.pop(0)
        snapshot = self._source_state.get(source)
        if snapshot is None or source == 'rover':
            return

        message = EcamAlertSourceSnapshot()
        message.source = snapshot.source
        message.timestamp.sec = snapshot.timestamp[0]
        message.timestamp.nanosec = snapshot.timestamp[1]
        message.active_codes = list(snapshot.active_codes)
        self._source_publisher.publish(message)

    def _publish_combined(self) -> None:
        message = EcamAlerts()
        message.timestamp = self.get_clock().now().to_msg()
        message.authority = self.role
        message.sources = []
        for source_snapshot in self._source_state.snapshots():
            snapshot = EcamAlertSourceSnapshot()
            snapshot.source = source_snapshot.source
            snapshot.timestamp.sec = source_snapshot.timestamp[0]
            snapshot.timestamp.nanosec = source_snapshot.timestamp[1]
            snapshot.active_codes = list(source_snapshot.active_codes)
            message.sources.append(snapshot)
        self._combined_publisher.publish(message)


def main(args: list[str] | None = None) -> None:
    rclpy.init(args=args)
    node = EcamAlertAggregator()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
