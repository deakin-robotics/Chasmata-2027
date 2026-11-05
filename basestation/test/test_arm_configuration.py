import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
JOINTS = ("base_joint", "shoulder_joint", "elbow_joint", "yaw_joint", "pitch_joint", "roll_joint")
FRAMES = ("base_link", "j4_pivot_link", "ee_link")


class ArmConfigurationTests(unittest.TestCase):
    # The GUI and MoveIt models expose the same controlled joints, limits and frames.
    def test_models_match(self):
        paths = (ROOT / "gui/public/assets/kinematics/arm.urdf", ROOT / "basestation/arm_moveit_config/config/arm.urdf")
        models = [ET.parse(path).getroot() for path in paths]
        joints = []
        for model in models:
            links = {link.attrib["name"] for link in model.findall("link")}
            self.assertTrue(set(FRAMES).issubset(links))
            controlled = {joint.attrib["name"]: joint for joint in model.findall("joint") if joint.attrib.get("type") != "fixed"}
            self.assertEqual(set(controlled), set(JOINTS))
            joints.append({name: controlled[name].find("limit").attrib for name in JOINTS})
        for name in JOINTS:
            for key in ("lower", "upper", "velocity"):
                self.assertEqual(float(joints[0][name][key]), float(joints[1][name][key]), (name, key))

    # MoveIt groups use the proximal pivot and full end-effector chains.
    def test_moveit_groups(self):
        root = ET.parse(ROOT / "basestation/arm_moveit_config/config/arm.srdf").getroot()
        groups = {group.attrib["name"]: group.find("chain").attrib for group in root.findall("group") if group.find("chain") is not None}
        self.assertEqual(groups["position_arm"], {"base_link": "base_link", "tip_link": "j4_pivot_link"})
        self.assertEqual(groups["arm"], {"base_link": "base_link", "tip_link": "ee_link"})
