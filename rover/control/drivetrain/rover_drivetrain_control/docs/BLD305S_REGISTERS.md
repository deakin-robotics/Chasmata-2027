# BLD-305S register reference

Every BLD-305S Modbus register this package reads or writes, with its meaning and scaling from the manufacturer manual:

**Manual:** [BLD-305S_Manual.pdf](https://github.com/mirmisbahali/deakin_rover/blob/main/dcr_base_station/base_station_ws/BLD-305S_Manual.pdf) (10 pages). The PDF is linked, not stored in this repository.

Pages are cited as the page number printed at the foot of the page, followed by the PDF page, which is one higher. For example, the register tables are on pp.6–7 (PDF pp.7–8).

> **Status of every entry: manual-cited, not bench-verified.** An address, meaning or scaling taken from the manual still needs a bench read on a real drive before anything relies on it. A Modbus ACK proves a reply was received, not that the meaning is right.

## Bus settings: p.5 (PDF p.6)

- Modbus RTU over two-wire RS485, CRC check, 8 data bits, 1 stop bit, no parity. Rates from 4800 to 256000 are supported.
- Only function code `03` (read holding registers) and `06` (write single register) are supported.
- Station addresses: `0` broadcast, `1`–`250` user, `251`–`255` reserved. The drive-address write range on p.6 (PDF p.7) is `1`–`247`, so stay within `1`–`247`. This package uses `1`–`4`.

## Never written by running code

| Register | Meaning | Manual | Why it must never be written |
|---|---|---|---|
| `0x00F6` | Baud rate code (FC `06`) | p.6 (PDF p.7) | Changing it moves the drive to a different baud rate and drops it off the shared bus. Provisioning is a separate, deliberate vendor-tool step. |
| `0x00A6` | Drive address (FC `06`), `1`–`247` | p.6 (PDF p.7) | Changing it moves the drive to a different slave ID; the wheel mapping would then point at the wrong drive or at none. |
| `0x80FF` | Parameter save: write `0x55AA` to keep modified parameters across power loss | p.7 (PDF p.8) | Saving makes any parameter change permanent, including a wrong baud code or address. |

No code in this package writes `0x00F6`, `0x00A6` or `0x80FF`, and no write method exists for them. `Bld305sDriver` also refuses any write to those three addresses. The diagnostics node issues reads only (function code `03`).

## Registers read (function code 03)

| Register | Meaning | Values / scaling (manual) | Manual | Accessed by | Status |
|---|---|---|---|---|---|
| `0x005F` | Actual motor speed | Raw value. Example: `0x0BB8` = 3000 RPM. Actual speed = value × communication-setting pole pairs ÷ actual motor pole pairs. **This package does not apply that conversion.** | pp.6–7 (PDF pp.7–8) | `readActualSpeedRaw()`, probe selector 8, bench `read()` | Manual-cited, not bench-verified |
| `0x0066` | Motor running status | `0` stop, `1` forward, `2` reverse, `3` stop brake | p.6 (PDF p.7) | `readRunningStatusRaw()`, probe selector 7, bench activation and stop confirmation | Manual-cited, not bench-verified |
| `0x0076` | Fault code | `1` overcurrent, `2` over temperature, `3` overpressure, `4` undervoltage, `5` sensor abnormality, `6` overspeed, `8` stalled, `9` peak current. `0` and `7` are not listed. | p.7 (PDF p.8) | `readFaultRaw()`, probe selector 6, bench configure and `read()` | Manual-cited, not bench-verified |
| `0x0096` | Driver internal temperature | Raw; no scaling given | p.7 (PDF p.8) | `readTemperatureRaw()`, probe selector 1 | Manual-cited, not bench-verified |
| `0x00A6` | Driver address | Slave ID as stored by the drive | p.7 (PDF p.8) | `readDriveAddressRaw()`, probe selector 4, bench configure | Manual-cited, not bench-verified |
| `0x00B6` | Actual motor current | Raw; no scaling given | p.7 (PDF p.8) | `readCurrentRaw()`, probe selector 2 | Manual-cited, not bench-verified |
| `0x00C6` | Actual motor voltage | Raw; no scaling given | p.7 (PDF p.8) | `readVoltageRaw()`, probe selector 3 | Manual-cited, not bench-verified |
| `0x00F6` | Baud rate code | `00`=4800, `01`=9600, `02`=14400, `03`=19200, `04`=38400, `05`=56000, `06`=57600, `07`=115200, `08`=128000, `09`=230400, `10H`=256000. Codes above `10H` fall back to 9600. Default `01`. | pp.6–7 (PDF pp.7–8) | `readBaudCodeRaw()`, probe selector 5 | Manual-cited, not bench-verified |
| `0x0116` | Number of motor pole pairs | `1`–`255`; default `05H`. This term appears in the actual-speed formula above. | pp.6–7 (PDF pp.7–8) | `readPolePairsRaw()`, probe selector 9, bench activation read-back | Manual-cited, not bench-verified |
| `0x0136` | Internal/external control mode | `01` internal, `00` external; default `01`. The manual lists this register for FC `06` only. 0x0136 does not answer reads on our controllers (times out, bench 2026-11-12); write-only, confirmed by write echo. | p.6 (PDF p.7) | `readControlModeRaw()`, probe selector 10 (times out on our controllers) | Bench-checked: reads time out |
| `0x0056` | Motor speed **setting** | The manual lists this register only for FC `06`; reading it back is not documented. It is a setpoint, not a measurement. | p.6 (PDF p.7) | `readSpeedRaw()` (no caller) | Manual-cited, not bench-verified |

The probe service returns raw values only. Its `detail` string may name the manual meaning of a value (for example "manual: overcurrent"), but never converts units.

The manual lists the baud code for 256000 as `10H`, after `09H`. It is unclear whether this means `0x10` or the next code, `0x0A`. Confirm on the bench before relying on it.

## Registers written (function code 06)

Only bench mode (`bench_motion_enabled: true`, see the README "Bench motion test") calls these write methods. With bench mode off, the hardware interface refuses configuration and activation, and the diagnostics node has no write path.

| Register | Meaning | Values / scaling (manual) | Manual | Accessed by | Status |
|---|---|---|---|---|---|
| `0x0056` | Motor speed setting | `0`–`4000`; default `0x05DC`. Example: `0x03E8` = 1000 RPM, so raw = motor RPM. | pp.6–7 (PDF pp.7–8) | `writeSpeedRaw()`: bench activation writes `0` (confirmed by the write echo; no read-back is documented), then bench `write()` | Manual-cited, not bench-verified |
| `0x0066` | Motor control | `0` stop, `1` forward (the examples call it "Start"), `2` reverse, `3` stop braking. Bench mode writes `0`, `1` and `2` only. | pp.6–7 (PDF pp.7–8) | `writeControlRaw()`: bench activation and `write()`. `broadcastStop()`: `0` to address `0` | Manual-cited, not bench-verified |
| `0x0116` | Number of motor pole pairs | `1`–`255`; default `05H` | p.6 (PDF p.7) | `writePolePairsRaw()`: bench activation writes `pole_pairs` and reads it back. Never saved. | Manual-cited, not bench-verified |
| `0x0136` | Internal/external control mode | `01` internal, `00` external. The "Internal mode" example frame writes `01`, per p.7 (PDF p.8). | pp.6–7 (PDF pp.7–8) | `writeControlModeRaw()`: bench activation writes `1`, confirmed by the write echo only. 0x0136 does not answer reads on our controllers (times out, bench 2026-11-12); write-only, confirmed by write echo. Never saved. | Manual-cited; write echo bench-checked, reads time out |

The broadcast stop goes to station address `0`, which the manual reserves for broadcast, per p.5 (PDF p.6). The manual does not say whether drives reply to it, so bench mode confirms every stop by reading each drive's running status `0x0066`.

Bench mode never writes `0x80FF`, so `0x0116` and `0x0136` revert to their stored values when a drive is power-cycled.

The manual also documents `0x0076` as a write register: writing `0` clears the fault code, per pp.6–7 (PDF pp.7–8). This package never does that.
