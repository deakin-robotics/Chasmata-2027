#!/usr/bin/env python3
"""Discover isolated SteadyWin GDZ motors and build a folded-calibration URDF."""

import argparse
import json
import math
import os
from pathlib import Path
import socket
import struct
import sys
import tempfile
import time
import xml.etree.ElementTree as ET


FRAME = struct.Struct("=IB3x8s")  # Linux struct can_frame
REPLIES = {0xA0: "<HHHB", 0xB0: "<BfB", 0xA3: "<Hi", 0xA4: "<BhhH", 0xAE: "<HHBBB"}


def query(interface, address, opcode):
    """Collect replies to one read request. A new socket excludes old queued replies."""
    layout = struct.Struct(REPLIES[opcode])
    replies = {}
    with socket.socket(socket.AF_CAN, socket.SOCK_RAW, socket.CAN_RAW) as bus:
        bus.bind((interface,))
        bus.send(FRAME.pack(address, 1, bytes([opcode])))
        deadline = time.monotonic() + 0.5
        while (remaining := deadline - time.monotonic()) > 0:
            bus.settimeout(remaining)
            try:
                can_id, length, data = FRAME.unpack(bus.recv(FRAME.size))
            except socket.timeout:
                break
            # CAN flags occupy high ID bits. Accept only unflagged GDZ device IDs.
            if not 1 <= can_id <= 254 or (address != 255 and can_id != address):
                continue
            if data[0] == opcode and length == 1 + layout.size:
                replies[can_id] = layout.unpack_from(data, 1)
                if address != 255:
                    break
    if not replies:
        raise ValueError(f"No valid 0x{opcode:02X} reply on {interface} for ID 0x{address:02X}")
    return replies


def inspect_motor(interface):
    devices = query(interface, 0xFF, 0xB0)
    if len(devices) != 1:
        raise ValueError(f"Expected one connected motor, found IDs {sorted(devices)}")
    address, (poles, torque, ratio) = next(iter(devices.items()))
    if address == 7:
        raise ValueError("Address 0x07 conflicts with the rover end effector")
    if ratio == 0 or not math.isfinite(torque):
        raise ValueError("Invalid motor parameters in B0 reply")
    boot, app, board, protocol = query(interface, address, 0xA0)[address]
    single, multi = query(interface, address, 0xA3)[address]
    temperature, current, speed, angle = query(interface, address, 0xA4)[address]
    voltage, bus_current, _, mode, faults = query(interface, address, 0xAE)[address]
    if max(single, angle) >= 16384:
        raise ValueError("Encoder sample outside the 14-bit range")
    return {
        "can_id": address, "reported_gear_ratio": ratio, "pole_pairs": poles,
        "torque_constant_Nm_per_A": torque, "boot_version": boot, "app_version": app,
        "hardware_code": board, "protocol_version": protocol,
        "multi_turn_count": multi, "single_turn_count": single,
        "temperature_C": temperature, "q_current_A": current / 1000,
        "speed_RPM": speed / 100, "bus_voltage_V": voltage / 100,
        "bus_current_A": bus_current / 100, "mode_code": mode, "fault_byte": faults,
    }


def save_new(path, contents):
    """Publish a complete file atomically, including when two operators race."""
    tmp = tempfile.NamedTemporaryFile(dir=path.parent, delete=False)
    try:
        with tmp:
            tmp.write(contents)
        os.link(tmp.name, path)
    finally:
        Path(tmp.name).unlink()


def limits(control_joint):
    position = control_joint.find("command_interface[@name='position']")
    return tuple(float(position.find(f"param[@name='{key}']").text) for key in ("min", "max"))


def validate(record, joint, used):
    name = joint.get("name")
    address = record["can_id"]
    if record["joint"] != name or type(address) is not int or not 1 <= address <= 254 or address == 7:
        raise ValueError(f"Invalid joint assignment or CAN address for {name}")
    if address in used:
        raise ValueError(f"{name} and {used[address]} both use CAN ID 0x{address:02X}")
    scale = record["motor_turns_per_joint_turn"]
    if not math.isfinite(scale) or not scale:
        raise ValueError(f"{name} requires a finite nonzero signed motor-to-joint ratio")
    lower, upper = limits(joint)
    if not lower <= record["folded_reference_rad"] <= upper:
        raise ValueError(f"Folded angle for {name} must be within [{lower}, {upper}] radians")


def commission(template, directory, interface):
    model = ET.parse(template)
    control = model.find("ros2_control")
    hardware = control.find("hardware")
    output = directory / "arm.urdf"
    if output.exists():
        raise FileExistsError(f"{output} already exists. Choose a new setup directory.")
    directory.mkdir(parents=True, exist_ok=True)
    used = {}
    joints = control.findall("joint")
    records = {}
    # Load previously confirmed joints first, including those later in model order.
    for joint in joints:
        name = joint.get("name")
        path = directory / f"{name}.json"
        if path.exists():
            record = json.loads(path.read_text())
            validate(record, joint, used)
            records[name] = record
            used[record["can_id"]] = name
            print(f"Loaded {name} at 0x{record['can_id']:02X} from {path}")
    for joint in joints:
        name = joint.get("name")
        if name in records:
            continue
        input(f"Connect ONLY the motor for {name} to {interface}. Press Enter to read it. ")
        record = inspect_motor(interface)
        address = record["can_id"]
        print(f"{name}, CAN ID 0x{address:02X}")
        print(json.dumps(record, indent=2))
        if address in used:
            raise ValueError(f"CAN ID 0x{address:02X} already belongs to {used[address]}")
        lower, upper = limits(joint)
        record["joint"] = name
        record["motor_turns_per_joint_turn"] = float(input(
            "Verified CAN motor turns per positive joint turn (include direction sign): "))
        record["folded_reference_rad"] = float(input(
            f"Joint angle in the physically folded pose [{lower}, {upper}] radians: "))
        validate(record, joint, used)
        print(f"{name} = 0x{address:02X}, reported ratio {record['reported_gear_ratio']}, "
              f"signed scale {record['motor_turns_per_joint_turn']}, "
              f"folded {record['folded_reference_rad']} rad")
        if input("Type yes to save this mapping: ").strip().lower() != "yes":
            raise ValueError(f"{name} was not confirmed")
        save_new(directory / f"{name}.json", json.dumps(record, indent=2).encode() + b"\n")
        records[name] = record
        used[address] = name
    for name, record in records.items():
        hardware.find(f"param[@name='{name}_can_id']").text = hex(record["can_id"])
        for key in ("folded_reference_rad", "motor_turns_per_joint_turn"):
            param = ET.SubElement(hardware, "param", name=f"{name}_{key}")
            param.text = str(record[key])
    hardware.find("param[@name='can_interface']").text = interface
    hardware.find("param[@name='motion_enabled']").text = "false"
    ET.indent(model)
    save_new(output, ET.tostring(model.getroot(), encoding="utf-8", xml_declaration=True))
    print(f"Profile saved to {output.resolve()}. Connect all motors, support the folded arm, "
          "launch with this URDF, assert E-stop, then call /arm/confirm_folded_pose.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="persistent setup directory")
    parser.add_argument("--interface", default="can0", help="configured Linux SocketCAN interface")
    args = parser.parse_args()
    from ament_index_python.packages import get_package_share_directory
    template = Path(get_package_share_directory("dcr_arm_driver")) / "urdf" / "robot_arm.urdf"
    try:
        commission(template, args.directory, args.interface)
    except (OSError, ValueError, KeyError, TypeError, EOFError, KeyboardInterrupt) as error:
        sys.exit(f"Setup stopped. Confirmed motor records are saved in {args.directory}. {error}")


if __name__ == "__main__":
    main()
