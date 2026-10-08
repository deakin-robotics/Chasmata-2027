"""Expose only per-camera MediaMTX readiness to operator browsers."""

import json
import os
from base64 import b64encode
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from urllib.request import Request, urlopen


CAMERAS = ("front", "gimbal", "arm")
API_URL = os.environ.get(
    "MEDIAMTX_API_URL", "http://media-gateway:9997/v3/paths/list"
)
API_USER = os.environ.get("MEDIAMTX_API_USER", "camera-health")
API_PASSWORD = os.environ.get("MEDIAMTX_API_PASSWORD", "local-camera-health")
ALLOWED_ORIGINS = {
    origin.strip()
    for origin in os.environ.get(
        "CAMERA_HEALTH_ALLOWED_ORIGINS",
        "http://localhost:4200,http://127.0.0.1:4200",
    ).split(",")
    if origin.strip()
}


def extract_readiness(payload):
    """Return readiness for the three public camera paths."""
    readiness = {camera: False for camera in CAMERAS}
    for item in payload.get("items", []):
        name = item.get("name")
        if name in readiness:
            readiness[name] = item.get("ready") is True
    return readiness


def get_readiness():
    """Query the private MediaMTX API and reduce it to the public status shape."""
    credential = b64encode(f"{API_USER}:{API_PASSWORD}".encode("utf-8")).decode("ascii")
    request = Request(API_URL, headers={"Authorization": f"Basic {credential}"})
    with urlopen(request, timeout=2) as response:
        payload = json.load(response)
    return extract_readiness(payload)


class CameraHealthHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        origin = self.headers.get("Origin")
        if origin not in ALLOWED_ORIGINS:
            self.send_error(403)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path != "/cameras/status":
            self.send_error(404)
            return

        try:
            payload = {
                "gatewayAvailable": True,
                "cameras": get_readiness(),
            }
        except Exception as error:
            print(f"camera-health: MediaMTX status query failed: {error}")
            payload = {
                "gatewayAvailable": False,
                "cameras": {camera: False for camera in CAMERAS},
            }

        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string, *args):
        print("camera-health: " + format_string % args)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 9998), CameraHealthHandler).serve_forever()
