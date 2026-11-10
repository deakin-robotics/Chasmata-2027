"""Transport regressions; run with the ROS environment sourced."""
import time
import unittest
from collections import deque
from unittest.mock import Mock, patch
from can_msgs.msg import Frame
from usb_mock_bridge import UsbMockBridge

class QueueTests(unittest.TestCase):
    def setUp(self):
        self.bridge = UsbMockBridge.__new__(UsbMockBridge)
        self.bridge.pending_arm = deque()
        self.bridge.pending_drive = deque()
        self.bridge.usb = Mock()
        self.bridge.usb.read.return_value = b''
        self.bridge.master = -1
        self.bridge.usb_buffer = bytearray()
        self.bridge.drive_buffer = bytearray()
        self.bridge.drive_replies = bytearray()
        self.bridge.last_send = 0
        self.bridge.last_drive_byte = 0

    def frame(self, command=0xC1, value=100):
        f = Frame(id=1, dlc=5)
        f.data = [command] + list(value.to_bytes(4, 'little')) + [0]*3
        return f

    def test_new_motion_supersedes_old_target_and_stop_has_priority(self):
        self.bridge.queue_arm(self.frame())
        self.bridge.queue_arm(self.frame(0xC2, 400))
        self.assertEqual(len(self.bridge.pending_arm), 1)
        self.bridge.queue_arm(self.frame(value=0))
        self.assertEqual(len(self.bridge.pending_arm), 1)
        self.assertIn(b'c100000000', self.bridge.pending_arm[0][1])

    def test_expired_packets_are_dropped(self):
        self.bridge.pending_arm.append((0, b'old', 1))
        self.bridge.pending_drive.append((0, b'old'))
        with patch('usb_mock_bridge.os.read', return_value=b''):
            self.bridge.poll_io()
        self.bridge.usb.write.assert_not_called()

    def test_no_burst_on_delayed_callback_and_shared_budget(self):
        expiry = time.monotonic()+1
        self.bridge.pending_arm.extend([(expiry,b'a',None),(expiry,b'b',None)])
        self.bridge.pending_drive.append((expiry,b'd'))
        with patch('usb_mock_bridge.os.read', return_value=b''):
            self.bridge.poll_io()
            self.bridge.poll_io()
        self.bridge.usb.write.assert_called_once_with(b'd')
        self.assertEqual(len(self.bridge.pending_arm), 2)

if __name__ == '__main__':
    unittest.main()
