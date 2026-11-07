# USB rover hardware simulator

Flash this sketch onto an Arduino-compatible microcontroller and connect it to the ROS computer using **one USB data cable**. The board receives commands and returns simulated feedback for six arm joints and four drivetrain controllers. It requires no GPIO connections, external modules, or additional Arduino libraries.

The host bridge lets the existing drivers share that USB connection:

```text
Arm driver <-> /socketcan_bridge/tx and /rx --+
                                           +-- USB bridge <-> USB <-> microcontroller
Drivetrain driver <-> virtual serial port --+
```

The board simulates software responses; it does not produce physical CAN or RS485 signals or operate motors.

## Files

| File | Purpose |
| --- | --- |
| [mock_hardware.ino](mock_hardware.ino) | Arduino IDE entry point, matching the folder name. |
| [mork_hardware.ino](mork_hardware.ino) | Simulator implementation and firmware settings. |
| [usb_mock_bridge.py](usb_mock_bridge.py) | Linux ROS 2 bridge for the USB connection. Runs on the computer, not the board. |

## 1. Upload the sketch

1. Connect the board with a USB data cable.
2. Open `mock_hardware.ino` in Arduino IDE. Keep both `.ino` files in this folder; Arduino compiles them together.
3. Select your board and USB port, then upload.
4. Close Serial Monitor before starting the USB bridge.

The default `USB_BAUD` in `mork_hardware.ino` is **500000**, with default Arduino 8N1 framing. If your board requires a different rate, change `USB_BAUD`, upload again, and supply the same `baud` parameter to the bridge.

The sketch sends feedback only when requested. A blank Serial Monitor after boot is expected.

## 2. Prepare the ROS computer

The bridge uses Linux pseudo-terminals, so run it on the Linux ROS computer. The computer must have Python 3, `pyserial`, ROS 2, and the `can_msgs` message package available.

On an Ubuntu ROS installation, install pyserial if necessary:

```bash
sudo apt install python3-serial
```

Source your ROS installation and built workspace in each terminal used for ROS commands. For this repository's Jazzy setup, for example:

```bash
source /opt/ros/jazzy/setup.bash
# Replace this with the install directory of your built ROS workspace:
source /path/to/workspace/install/setup.bash
```

Check that the message type is available:

```bash
ros2 interface show can_msgs/msg/Frame
```

Find the board's physical USB port:

```bash
ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null
```

The examples below use `/dev/ttyACM0`; replace it with your board's port.

## 3. Start the USB bridge

From the repository root:

```bash
python3 microcontroller/mock_hardware/usb_mock_bridge.py \
  --ros-args -p port:=/dev/ttyACM0
```

For a different firmware baud rate, also pass `-p baud:=115200`, for example. It must match the uploaded sketch's `USB_BAUD`.

After a two-second board-reset delay, the bridge logs something like:

```text
USB simulator: /dev/ttyACM0 at 500000 baud
Set drivetrain serial_device to: /dev/pts/7 (38400, 8N1)
```

Keep this terminal running. The virtual `/dev/pts/...` path can change each time the bridge starts.

Only the bridge should open the physical USB port. Close Serial Monitor and other serial tools. For this simulator, run the USB bridge in place of `nobleo_socketcan_bridge`; no physical `can0` interface setup is needed.

## 4. Connect the arm driver

With the USB bridge running, start the existing arm launch in a sourced terminal:

```bash
ros2 launch dcr_arm_driver arm_control.launch.py
```

The bridge subscribes to `/socketcan_bridge/tx` and publishes simulated responses on `/socketcan_bridge/rx`, using the existing `can_msgs/msg/Frame` payloads. Arm IDs `1` through `6` match the current arm URDF.

Inspect feedback with:

```bash
ros2 topic echo /motor_stat_1
```

The normal arm driver's E-stop, feedback freshness, and command-rearming requirements still apply. Receiving feedback does not by itself enable movement commands. See the [arm driver documentation](../../rover/control/arm/rover_ws/src/dcr_arm_driver/README.md) for command and controller usage.

### Check arm feedback without starting the arm driver

With only the USB bridge running, start a listener in a second sourced terminal:

```bash
ros2 topic echo --once /socketcan_bridge/rx
```

In another sourced terminal, request joint 1's status:

```bash
ros2 topic pub --once /socketcan_bridge/tx can_msgs/msg/Frame \
  '{id: 1, dlc: 1, data: [164, 0, 0, 0, 0, 0, 0, 0]}'
```

The listener should receive ID `1`, DLC `8`, and initial data `[164, 25, 0, 0, 0, 0, 0, 0]`: status command `0xA4`, temperature `25`, zero current, zero speed, and zero angle.

## 5. Connect or test the drivetrain

Use the virtual port printed by the bridge, **not the physical USB port**, for drivetrain communication:

```yaml
serial_device: /dev/pts/7  # Replace with the bridge's printed path
baud_rate: 38400
parity: 'N'
data_bits: 8
stop_bits: 1
fl_id: 1
rl_id: 2
fr_id: 3
rr_id: 4
```

The virtual port uses the drivetrain driver's 38400/8N1 settings while the bridge handles the physical USB link at 500000 baud. The snippet above is only the communication portion of the configuration. The [drivetrain example configuration](../../rover/control/drivetrain/rover_drivetrain_control/config/drivetrain_hardware.example.yaml) contains the other required fields.

**Current driver limitation:** `RoverHardwareInterface::on_configure()` opens the transport, then refuses configuration because verified controller initialization and velocity conversion are unimplemented. Separately, `Bld305sDriver::readFaultRaw()` returns `UNSUPPORTED` without a wire request. The simulator supports raw communication checks; it does not make the production drivetrain controller activate or pass its full health checks.

### Check drivetrain feedback without starting the drivetrain driver

Leave the bridge running and replace `/dev/pts/7` below with its printed path. This writes a synthetic raw speed setpoint of `100` to controller 1, then reads it back:

```bash
python3 - <<'PY'
import serial

with serial.Serial('/dev/pts/7', 38400, timeout=1) as port:
    port.write(bytes.fromhex('01 06 00 56 00 64 68 31'))
    print('Write ACK:', port.read(8).hex(' '))
    port.write(bytes.fromhex('01 03 00 56 00 01 64 1a'))
    print('Read reply:', port.read(7).hex(' '))
PY
```

Expected output:

```text
Write ACK: 01 06 00 56 00 64 68 31
Read reply: 01 03 02 00 64 b9 af
```

Use only one drivetrain client at a time on the virtual port.

### Drivetrain-only operation without the bridge

Change `USB_BAUD` to `38400` and upload again. Point your raw Modbus client directly at the board's physical USB port using 38400/8N1. Do not run the bridge in this configuration. The same read/write example works after replacing its port with the physical USB port.

## Simulated behavior

| Component | Behavior |
| --- | --- |
| Arm position | Moves toward the commanded angle at up to 20 RPM; encoder feedback wraps to one revolution. |
| Arm speed | Integrates commanded RPM into position; commands are clamped to ±300 RPM. |
| Arm status | Returns synthetic 25°C temperature, 24 V bus voltage, zero current, active mode, and no faults. |
| Arm home | Resets the selected joint's simulated position and speed to zero. |
| Drivetrain | Stores raw setpoint/control values and returns synthetic speed and diagnostics. Control words are stored without assuming undocumented enable/direction bit meanings. |
| Command timeout | After 500 ms without a new motion command, arm motion stops and drivetrain actual-speed feedback becomes zero. Reading status does not refresh this timeout. |
| Reset | Rebooting or reflashing the board clears all simulated state. |

Supported drivetrain operations are holding-register reads (`0x03`) and single-register writes (`0x06`). Register `0x0056` is the stored setpoint, `0x005F` is synthetic actual speed, and `0x0066` is the stored control word. The simulator also handles initialization storage at `0x0136`/`0x0116` and raw diagnostics at `0x0096`/`0x00B6`/`0x00C6`. These reproduce the repository's software register mapping, not a verified motor specification.

## Troubleshooting and shutdown

| Symptom | Check |
| --- | --- |
| USB port missing | Use a data-capable USB cable and confirm the selected board/port. |
| Permission denied opening USB | Check port ownership and your Linux serial-device group membership, commonly `dialout`; log in again after a membership change. |
| Port busy | Close Serial Monitor, other serial clients, and any previous bridge instance. |
| `No module named serial` | Install `python3-serial` for the Python interpreter running the bridge. |
| `rclpy` or `can_msgs` missing | Source the ROS installation and workspace containing the message package. |
| No feedback | Confirm matching USB baud rates, the bridge is running, and commands are reaching its topics or virtual port. |
| Drivetrain opens the wrong port | Use the latest `/dev/pts/...` path logged by the current bridge instance. |
| USB command queue full | Reduce the arm update rate or use a higher baud supported by both the board and host. |
| Drivetrain refuses to configure | See the driver limitations above; a successful serial connection does not remove that gate. |

Stop the driver processes and press **Ctrl+C** in the bridge terminal. Its virtual port disappears when the bridge exits; start the bridge again before restarting clients.
