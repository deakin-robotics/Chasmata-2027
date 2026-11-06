import sys
import unittest
import json
import io
import threading
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "camera-health"))
import server
from server import extract_readiness


class ExtractReadinessTests(unittest.TestCase):
    # The response includes only the three cameras and preserves their readiness.
    def test_reports_only_ready_for_the_three_camera_paths(self):
        result = extract_readiness(
            {
                "items": [
                    {"name": "front", "ready": True},
                    {"name": "gimbal", "ready": False},
                    {"name": "arm", "ready": True},
                    {"name": "unrelated", "ready": True},
                ]
            }
        )

        self.assertEqual(result, {"front": True, "gimbal": False, "arm": True})

    # Missing camera paths are reported unavailable.
    def test_missing_camera_paths_are_not_ready(self):
        self.assertEqual(
            extract_readiness({"items": []}),
            {"front": False, "gimbal": False, "arm": False},
        )

    # Each camera can independently become ready, and only true means ready.
    def test_each_camera_is_independent(self):
        for name in server.CAMERAS:
            with self.subTest(camera=name):
                result = extract_readiness({"items": [{"name": name, "ready": True}]})
                self.assertEqual(result, {camera: camera == name for camera in server.CAMERAS})
        self.assertFalse(extract_readiness({"items": [{"name": "arm", "ready": 1}]})["arm"])


class CameraHealthHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.CameraHealthHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    # Healthy gateway results are returned with no-store and permitted CORS headers.
    def test_status_and_allowed_origin(self):
        with patch.object(server, "get_readiness", return_value={"front": True, "gimbal": False, "arm": True}):
            request = Request(self.base_url + "/cameras/status?test=1", headers={"Origin": "http://localhost:4200"})
            with urlopen(request, timeout=2) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers["Cache-Control"], "no-store")
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], "http://localhost:4200")
                self.assertEqual(json.load(response), {"gatewayAvailable": True, "cameras": {"front": True, "gimbal": False, "arm": True}})

    # Gateway errors and timeouts produce unavailable status for all cameras.
    def test_gateway_unavailable(self):
        for error in (URLError("connection refused"), TimeoutError("timeout"), ValueError("invalid JSON")):
            with self.subTest(error=error), patch.object(server, "get_readiness", side_effect=error):
                with urlopen(self.base_url + "/cameras/status", timeout=2) as response:
                    self.assertEqual(json.load(response), {"gatewayAvailable": False, "cameras": dict.fromkeys(server.CAMERAS, False)})

    # Unsupported routes return 404 and disallowed origins cannot preflight.
    def test_unknown_path_and_disallowed_origin(self):
        with self.assertRaises(HTTPError) as unknown:
            urlopen(self.base_url + "/unknown", timeout=2)
        self.assertEqual(unknown.exception.code, 404)
        request = Request(self.base_url + "/cameras/status", method="OPTIONS", headers={"Origin": "http://untrusted.example"})
        with self.assertRaises(HTTPError) as forbidden:
            urlopen(request, timeout=2)
        self.assertEqual(forbidden.exception.code, 403)
        with patch.object(server, "get_readiness", return_value=dict.fromkeys(server.CAMERAS, False)):
            request = Request(self.base_url + "/cameras/status", headers={"Origin": "http://untrusted.example"})
            with urlopen(request, timeout=2) as response:
                self.assertIsNone(response.headers.get("Access-Control-Allow-Origin"))

    # Allowed origins receive a successful CORS preflight response.
    def test_allowed_preflight(self):
        request = Request(self.base_url + "/cameras/status", method="OPTIONS", headers={"Origin": "http://localhost:4200"})
        with urlopen(request, timeout=2) as response:
            self.assertEqual(response.status, 204)
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], "http://localhost:4200")


class CameraGatewayQueryTests(unittest.TestCase):
    # Gateway queries use a bounded timeout and convert the returned paths to camera readiness.
    def test_query_uses_timeout_and_parses_response(self):
        body = json.dumps({"items": [{"name": "front", "ready": True}]}).encode()
        with patch.object(server, "urlopen", return_value=io.BytesIO(body)) as request:
            self.assertEqual(server.get_readiness(), {"front": True, "gimbal": False, "arm": False})
            self.assertEqual(request.call_args.kwargs["timeout"], 2)


if __name__ == "__main__":
    unittest.main()
