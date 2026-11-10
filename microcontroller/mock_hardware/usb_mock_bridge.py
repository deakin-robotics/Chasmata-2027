#!/usr/bin/env python3
"""Connect the USB-only simulator to the existing ROS 2 motor drivers.

Run on the Linux ROS computer, with its ROS workspace sourced and pyserial
installed:

  python3 usb_mock_bridge.py --ros-args -p port:=/dev/ttyACM0

Set drivetrain serial_device to the /dev/pts/... path logged at startup.
The drivetrain keeps its 38400/8N1 configuration on that virtual port;
the physical USB link uses 500000 baud, matching USB_BAUD in the sketch.
This replaces the physical socketcan bridge for the arm. Do not run both.
For a board requiring another USB rate, change USB_BAUD and -p baud:=... .
No driver or firmware safety/activation gates are overridden.
"""

import errno
import os
import pty
import time
import tty
from collections import deque

import rclpy
from can_msgs.msg import Frame
from rclpy.node import Node
import serial


def crc16(data):
    crc = 0xFFFF
    for value in data:
        crc ^= value
        for _ in range(8):
            crc = (crc >> 1) ^ (0xA001 if crc & 1 else 0)
    return crc


def encode_arm(frame):
    if frame.is_extended or frame.is_rtr or frame.is_error:
        return None
    if not 0 <= frame.id <= 0x7FF or not 1 <= frame.dlc <= 8:
        return None
    return f"t{frame.id:03X}{frame.dlc:X}{bytes(frame.data[:frame.dlc]).hex()}\r".encode("ascii")


def extract_responses(buffer):
    """Consume complete USB responses, retaining any incomplete tail."""
    while buffer:
        if buffer[0] == ord("t"):
            end = buffer.find(b"\r")
            if end < 0:
                if len(buffer) <= 21:
                    return
                del buffer[0]
                continue
            packet = bytes(buffer[:end])
            del buffer[:end + 1]
            try:
                can_id = int(packet[1:4], 16)
                dlc = int(packet[4:5], 16)
                data = bytes.fromhex(packet[5:].decode("ascii"))
                if (len(packet) == 5 + 2 * dlc and 1 <= dlc <= 8
                        and len(data) == dlc and 0 <= can_id <= 0x7FF):
                    yield "arm", (can_id, data)
            except (ValueError, UnicodeError):
                pass
        elif 1 <= buffer[0] <= 4:
            if len(buffer) < 3:
                return
            function = buffer[1]
            if function == 3 and buffer[2] <= 16:
                length = 5 + buffer[2]
            elif function == 6:
                length = 8
            elif function & 0x80:
                length = 5
            else:
                del buffer[0]
                continue
            if len(buffer) < length:
                return
            packet = bytes(buffer[:length])
            if crc16(packet) == 0:
                del buffer[:length]
                yield "drive", packet
            else:
                del buffer[0]
        else:
            del buffer[0]


class UsbMockBridge(Node):
    def __init__(self):
        super().__init__("usb_mock_bridge")
        port = self.declare_parameter("port", "/dev/ttyACM0").value
        baud = self.declare_parameter("baud", 500000).value
        self.usb = serial.Serial(port, baud, timeout=0, write_timeout=0.1, exclusive=True)
        # Many development boards reset when USB serial opens.
        time.sleep(2)
        self.usb.reset_input_buffer()
        self.master, self.slave = pty.openpty()
        tty.setraw(self.slave)
        os.set_blocking(self.master, False)
        self.usb_buffer = bytearray()
        self.drive_buffer = bytearray()
        self.drive_replies = bytearray()
        self.pending_arm = deque()
        self.last_drive_byte = time.monotonic()
        self.publisher = self.create_publisher(Frame, "/socketcan_bridge/rx", 100)
        self.subscription = self.create_subscription(
            Frame, "/socketcan_bridge/tx", self.queue_arm, 100)
        self.timer = self.create_timer(0.001, self.poll)
        self.get_logger().info(f"USB simulator: {port} at {baud} baud")
        self.get_logger().info(
            f"Set drivetrain serial_device to: {os.ttyname(self.slave)} (38400, 8N1)")

    def queue_arm(self, frame):
        packet = encode_arm(frame)
        if packet is not None:
            if len(self.pending_arm) >= 256:
                self.get_logger().error("USB command queue full; reduce arm update rate")
                return
            self.pending_arm.append(packet)

    def poll(self):
        try:
            self.poll_io()
        except (OSError, serial.SerialException) as error:
            self.get_logger().error(f"USB mock bridge stopped: {error}")
            self.timer.cancel()
            # Ending the process also closes the PTY, so drivers see the loss.
            raise

    def poll_io(self):
        now = time.monotonic()
        if self.drive_buffer and now - self.last_drive_byte > 0.05:
            self.drive_buffer.clear()
        try:
            incoming = os.read(self.master, 256)
        except BlockingIOError:
            incoming = b""
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            incoming = b""
        if incoming:
            self.drive_buffer.extend(incoming)
            self.last_drive_byte = now
        # Existing Bld305sDriver only sends fixed eight-byte 03/06 requests.
        while len(self.drive_buffer) >= 8:
            request = bytes(self.drive_buffer[:8])
            del self.drive_buffer[:8]
            if (request[0] <= 4 and request[1] in (3, 6)
                    and crc16(request) == 0):
                self.usb.write(request)
        for _ in range(min(16, len(self.pending_arm))):
            self.usb.write(self.pending_arm.popleft())
        self.usb_buffer.extend(self.usb.read(4096))
        for kind, payload in extract_responses(self.usb_buffer):
            if kind == "drive":
                self.drive_replies.extend(payload)
            else:
                can_id, data = payload
                frame = Frame()
                frame.header.stamp = self.get_clock().now().to_msg()
                frame.id = can_id
                frame.dlc = len(data)
                frame.data = list(data) + [0] * (8 - len(data))
                self.publisher.publish(frame)
        if self.drive_replies:
            try:
                written = os.write(self.master, self.drive_replies)
                del self.drive_replies[:written]
            except BlockingIOError:
                pass

    def destroy_node(self):
        self.timer.cancel()
        self.usb.close()
        os.close(self.master)
        os.close(self.slave)
        return super().destroy_node()


def main():
    rclpy.init()
    node = None
    try:
        node = UsbMockBridge()
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        if node is not None:
            node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
