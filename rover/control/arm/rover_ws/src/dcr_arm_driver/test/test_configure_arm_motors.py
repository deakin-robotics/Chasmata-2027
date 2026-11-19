from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch
import xml.etree.ElementTree as ET

PACKAGE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE / "scripts"))
import configure_arm_motors as setup


class CommissionTest(unittest.TestCase):
    def test_inspect_reads_only_gdz_queries_and_ignores_other_traffic(self):
        responses = [
            (0xB0, "<BfB", (12, 0.5, 36)),
            (0xA0, "<HHHB", (21, 3028, 45, 7)),
            (0xA3, "<Hi", (10, -140500)),
            (0xA4, "<BhhH", (25, -900, -250, 10)),
            (0xAE, "<HHBBB", (2410, 150, 25, 0, 8)),
        ]
        sockets = []
        for opcode, layout, fields in responses:
            payload = bytes([opcode]) + struct.pack(layout, *fields)
            sock = MagicMock()
            sock.__enter__.return_value = sock
            sock.recv.side_effect = [
                setup.FRAME.pack(0x80000005, len(payload), payload),
                setup.FRAME.pack(5, 1, bytes([opcode])),
                setup.FRAME.pack(5, len(payload), payload),
                setup.socket.timeout(),
            ]
            sockets.append(sock)
        with patch.object(setup.socket, "AF_CAN", 29, create=True), \
             patch.object(setup.socket, "CAN_RAW", 1, create=True), \
             patch.object(setup.socket, "socket", side_effect=sockets):
            record = setup.inspect_motor("can0")
        for sock, (opcode, _, _) in zip(sockets, responses):
            address = 255 if opcode == 0xB0 else 5
            sock.send.assert_called_once_with(setup.FRAME.pack(address, 1, bytes([opcode])))
        self.assertEqual(record["can_id"], 5)
        self.assertEqual(record["app_version"], 3028)
        self.assertEqual(record["reported_gear_ratio"], 36)
        self.assertEqual(record["multi_turn_count"], -140500)
        self.assertEqual(record["speed_RPM"], -2.5)
        self.assertEqual(record["fault_byte"], 8)

    def test_multiple_motors_rejected_before_assignment(self):
        with patch.object(setup, "query", return_value={3: (), 5: ()}):
            with self.assertRaisesRegex(ValueError, "Expected one"):
                setup.inspect_motor("can0")

    def test_resume_rejects_duplicate_and_outputs_complete_profile(self):
        template = PACKAGE / "urdf" / "robot_arm.urdf"
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            def run(ids, answers):
                motors = [{"can_id": address, "reported_gear_ratio": 36} for address in ids]
                with patch.object(setup, "inspect_motor", side_effect=motors), \
                     patch("builtins.input", side_effect=answers), patch("builtins.print"):
                    setup.commission(template, directory, "can1")

            with self.assertRaisesRegex(ValueError, "already belongs"):
                run([10, 10], ["", "-36", "1", "yes", ""])
            self.assertTrue((directory / "base_joint.json").exists())
            self.assertFalse((directory / "arm.urdf").exists())
            run(range(11, 16), ["", "1", "0", "yes"] * 5)
            hardware = ET.parse(directory / "arm.urdf").find("./ros2_control/hardware")
            params = {p.get("name"): p.text for p in hardware.findall("param")}
            self.assertEqual(params["base_joint_motor_turns_per_joint_turn"], "-36.0")
            self.assertEqual(params["base_joint_folded_reference_rad"], "1.0")
            self.assertEqual(params["roll_joint_can_id"], "0xf")
            self.assertEqual(params["motion_enabled"], "false")
            self.assertEqual(params["can_interface"], "can1")
            with self.assertRaises(FileExistsError):
                run([], [])
