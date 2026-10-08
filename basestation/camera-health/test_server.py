import unittest

from server import extract_readiness


class ExtractReadinessTests(unittest.TestCase):
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

    def test_missing_camera_paths_are_not_ready(self):
        self.assertEqual(
            extract_readiness({"items": []}),
            {"front": False, "gimbal": False, "arm": False},
        )


if __name__ == "__main__":
    unittest.main()
