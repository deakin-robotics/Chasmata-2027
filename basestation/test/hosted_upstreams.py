"""Provide distinguishable WebSocket upstreams for hosted-route tests."""
import hashlib
import base64
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def handler(label):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            key = self.headers.get("Sec-WebSocket-Key", "")
            if self.headers.get("Upgrade", "").lower() != "websocket" or not key:
                self.send_error(400)
                return
            accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
            self.send_response(101, "Switching Protocols")
            self.send_header("Upgrade", "websocket")
            self.send_header("Connection", "Upgrade")
            self.send_header("Sec-WebSocket-Accept", accept)
            self.send_header("X-Test-Upstream", label)
            self.end_headers()
            header = self.rfile.read(2)
            if len(header) != 2 or not (header[1] & 0x80):
                return
            length = header[1] & 0x7f
            if length > 125:
                return
            mask = self.rfile.read(4)
            payload = self.rfile.read(length)
            if len(mask) != 4 or len(payload) != length:
                return
            decoded = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
            self.wfile.write(bytes([0x81, len(decoded)]) + decoded)
    return Handler


servers = [ThreadingHTTPServer(("0.0.0.0", port), handler(label)) for port, label in ((9090, "rover"), (9091, "basestation"))]
for instance in servers:
    threading.Thread(target=instance.serve_forever, daemon=True).start()
threading.Event().wait()
