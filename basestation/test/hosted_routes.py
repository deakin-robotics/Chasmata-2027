"""Exercise the production Nginx routes against isolated test upstreams."""
import json
import os
import socket
import unittest
from urllib.request import Request, urlopen


BASE = os.environ["BASESTATION_TEST_URL"]
HOST, PORT = BASE.removeprefix("http://").split(":")
SDP_OFFER = ("v=0\r\n"
             "o=- 123456 2 IN IP4 127.0.0.1\r\n"
             "s=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=msid-semantic: WMS\r\n"
             "m=video 9 UDP/TLS/RTP/SAVPF 96\r\nc=IN IP4 0.0.0.0\r\n"
             "a=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:test\r\n"
             "a=ice-pwd:basestation-test-password-123\r\n"
             "a=fingerprint:sha-256 " + ":".join(["AA"] * 32) + "\r\n"
             "a=setup:actpass\r\na=mid:0\r\na=recvonly\r\na=rtcp-mux\r\n"
             "a=rtpmap:96 H264/90000\r\na=fmtp:96 packetization-mode=1;profile-level-id=42e01f\r\n")


class HostedRoutesTests(unittest.TestCase):
    # The hosted application serves the Driver, Arm and ECAM client routes.
    def test_operator_routes(self):
        for route in ("driver", "arm", "ecam"):
            with self.subTest(route=route), urlopen(f"{BASE}/{route}", timeout=5) as response:
                self.assertEqual(response.status, 200)
                self.assertIn(b"<app-root", response.read())

    # Each WebSocket path upgrades and reaches its distinct ROSbridge upstream.
    def test_rosbridge_websocket_routes(self):
        for label in ("rover", "basestation"):
            with self.subTest(upstream=label), socket.create_connection((HOST, int(PORT)), timeout=5) as connection:
                request = (f"GET /ros/{label} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n")
                connection.sendall(request.encode())
                response = b""
                while b"\r\n\r\n" not in response:
                    part = connection.recv(4096)
                    if not part:
                        break
                    response += part
                self.assertIn(b" 101 ", response)
                self.assertIn(f"x-test-upstream: {label}".encode(), response.lower())
                mask = b"\x01\x02\x03\x04"
                message = b"hello"
                encoded = bytes(value ^ mask[index % 4] for index, value in enumerate(message))
                connection.sendall(b"\x81\x85" + mask + encoded)
                frame = b""
                while len(frame) < 7:
                    part = connection.recv(7 - len(frame))
                    if not part:
                        break
                    frame += part
                self.assertEqual(frame, b"\x81\x05hello")

    # The camera-health endpoint is routed to the BaseStation health service.
    def test_camera_health_proxy(self):
        with urlopen(f"{BASE}/camera-health/cameras/status", timeout=5) as response:
            payload = json.load(response)
        self.assertTrue(payload["gatewayAvailable"])
        self.assertTrue(all(payload["cameras"][name] for name in ("front", "gimbal", "arm")))

    # Each hosted WHEP route accepts a video offer while the camera is publishing.
    def test_media_proxy(self):
        for name in ("front", "gimbal", "arm"):
            with self.subTest(camera=name):
                request = Request(f"{BASE}/media/{name}/whep", data=SDP_OFFER.encode(),
                                  headers={"Content-Type": "application/sdp"}, method="POST")
                with urlopen(request, timeout=10) as response:
                    self.assertEqual(response.status, 201)
                    self.assertIn(b"m=video", response.read())


if __name__ == "__main__":
    unittest.main(verbosity=2)
