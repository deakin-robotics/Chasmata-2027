"""Small source-state API for Rover, BaseStation, and other ROS processes."""

from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from telemetry_interfaces.msg import EcamAlertSourceSnapshot


SOURCE_TOPIC = '/ecam/alerts/source'
SOURCE_NAMES = frozenset({'driver', 'ecam', 'arm', 'basestation', 'rover'})


def ecam_snapshot_qos() -> QoSProfile:
    return QoSProfile(
        depth=1,
        reliability=ReliabilityPolicy.RELIABLE,
        durability=DurabilityPolicy.TRANSIENT_LOCAL,
    )


class EcamAlertSource:
    """Publishes complete source state; call raise_alert/clear from a feature."""

    def __init__(self, node: Node, source: str) -> None:
        if source not in SOURCE_NAMES:
            raise ValueError(f'Unknown ECAM reporting source: {source}')

        self._node = node
        self.source = source
        self._active_codes: set[str] = set()
        self._last_snapshot_timestamp = (0, 0)
        self._publisher = node.create_publisher(
            EcamAlertSourceSnapshot,
            SOURCE_TOPIC,
            ecam_snapshot_qos(),
        )
        self.publish_snapshot()

    @property
    def active_codes(self) -> frozenset[str]:
        return frozenset(self._active_codes)

    @property
    def last_snapshot_timestamp(self) -> tuple[int, int]:
        return self._last_snapshot_timestamp

    def raise_alert(self, code: str) -> None:
        normalized = code.strip()
        if not normalized or normalized in self._active_codes:
            return
        self._active_codes.add(normalized)
        self.publish_snapshot()

    def clear(self, code: str) -> None:
        normalized = code.strip()
        if normalized not in self._active_codes:
            return
        self._active_codes.remove(normalized)
        self.publish_snapshot()

    def clear_all(self) -> None:
        if not self._active_codes:
            return
        self._active_codes.clear()
        self.publish_snapshot()

    def publish_snapshot(self) -> None:
        message = EcamAlertSourceSnapshot()
        message.source = self.source
        message.timestamp = self._node.get_clock().now().to_msg()
        message.active_codes = sorted(self._active_codes)
        self._last_snapshot_timestamp = (
            int(message.timestamp.sec),
            int(message.timestamp.nanosec),
        )
        self._publisher.publish(message)
