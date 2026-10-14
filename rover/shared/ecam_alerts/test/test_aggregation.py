import time
import unittest

try:
    import rclpy
    from rclpy.executors import SingleThreadedExecutor
    from rclpy.node import Node
    from std_msgs.msg import Empty
    from telemetry_interfaces.msg import EcamAlerts

    from ecam_alerts.aggregator import EcamAlertAggregator, combined_qos
    from ecam_alerts.source import EcamAlertSource

    ROS_AVAILABLE = True
except ModuleNotFoundError:
    ROS_AVAILABLE = False


@unittest.skipUnless(ROS_AVAILABLE, 'ROS 2 packages are available in the container build')
class EcamAlertAggregationTest(unittest.TestCase):
    def test_rover_primary_failover_source_replay_and_handback(self):
        rclpy.init()
        executor = SingleThreadedExecutor()
        observed = []
        nodes = []
        rover = EcamAlertAggregator('rover', 0.6, 'test_rover_aggregator')
        base = EcamAlertAggregator('basestation', 0.6, 'test_base_aggregator')
        source_node = Node('test_ecam_source')
        reporter = EcamAlertSource(source_node, 'driver')
        heartbeat_publisher = source_node.create_publisher(Empty, '/rover/heartbeat', 1)

        def publish_heartbeat():
            heartbeat_publisher.publish(Empty())

        heartbeat_timer = source_node.create_timer(0.1, publish_heartbeat)
        source_node.create_subscription(
            EcamAlerts,
            '/ecam/alerts',
            lambda message: self._record_snapshot(observed, message),
            combined_qos(),
        )

        nodes.extend([rover, base, source_node])
        for node in nodes:
            executor.add_node(node)
        try:
            self.assertTrue(self._wait_for(executor, lambda: base._rover_alive, 2.0))
            reporter.raise_alert('TEST_DRIVER_ALERT')
            self.assertTrue(
                self._wait_for(
                    executor,
                    lambda: self._latest_has_code(observed, 'rover', 'TEST_DRIVER_ALERT'),
                    2.0,
                )
            )

            heartbeat_timer.cancel()
            self.assertTrue(
                self._wait_for(
                    executor,
                    lambda: self._latest_has_code(
                        observed, 'basestation', 'TEST_DRIVER_ALERT'
                    ),
                    2.0,
                )
            )
            self.assertIn('TEST_DRIVER_ALERT', self._latest_codes(observed, 'basestation'))

            executor.remove_node(rover)
            rover.destroy_node()
            nodes.remove(rover)
            heartbeat_timer.reset()
            self.assertTrue(
                self._wait_for(executor, lambda: base._awaiting_rover_reflection, 2.0)
            )
            rover = EcamAlertAggregator('rover', 0.6, 'test_rover_aggregator_returned')
            executor.add_node(rover)
            nodes.append(rover)

            self.assertTrue(
                self._wait_for(
                    executor,
                    lambda: self._latest_has_code(observed, 'rover', 'TEST_DRIVER_ALERT'),
                    2.0,
                )
            )
            self.assertTrue(self._wait_for(executor, lambda: not base._taking_over, 2.0))
            self.assertIn('TEST_DRIVER_ALERT', self._latest_codes(observed, 'rover'))

            reporter.clear('TEST_DRIVER_ALERT')
            self.assertTrue(
                self._wait_for(
                    executor,
                    lambda: not self._latest_has_code(
                        observed, 'rover', 'TEST_DRIVER_ALERT'
                    ),
                    2.0,
                )
            )
        finally:
            executor.shutdown()
            for node in nodes:
                executor.remove_node(node)
                node.destroy_node()
            rclpy.shutdown()

    @staticmethod
    def _record_snapshot(observed, message):
        snapshot = {
            'authority': message.authority,
            'sources': {
                source.source: tuple(source.active_codes)
                for source in message.sources
            },
        }
        observed.append(snapshot)

    @staticmethod
    def _latest_codes(observed, authority):
        for snapshot in reversed(observed):
            if snapshot['authority'] == authority:
                return snapshot['sources'].get('driver', ())
        return ()

    @staticmethod
    def _latest_has_code(observed, authority, code):
        return code in EcamAlertAggregationTest._latest_codes(observed, authority)

    @staticmethod
    def _wait_for(executor, predicate, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return True
            executor.spin_once(timeout_sec=0.02)
        return predicate()


if __name__ == '__main__':
    unittest.main()
