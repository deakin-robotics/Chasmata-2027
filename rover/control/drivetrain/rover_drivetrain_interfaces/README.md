# rover_drivetrain_interfaces

Read-only telemetry and diagnostic interfaces for the drivetrain. Forrest confirmed
(12 Oct 2026) that the address, speed, direction and result fields are for **logging on
the GUI**, not for commanding motors.

**All motor commands go through `ros2_control` only.** This package deliberately has
no motor-command message or service, and nothing should be added that lets a GUI or
tool write to a drive outside `ros2_control`.

## Messages

- `WheelTelemetry.msg`: one wheel's log record, in three separate groups:
  - **Commanded**: what the `ros2_control` controller asked for (`commanded_*`).
    Only logged here. `commanded_valid=false` means no command is known.
  - **Measured**: what was read back from the drive (`measured_*`, `raw_*`). Each
    value has its own `*_valid` flag. Converted speed stays NaN with
    `measured_speed_valid=false` until the register and scaling are verified (AD-23).
  - **Communication**: what actually happened on the wire (`last_write_result`,
    `last_read_result`, `last_error_code`, `comm_state`). `RESULT_ACKNOWLEDGED`
    means a valid Modbus reply, **not** that the wheel moved.

  Every zero default means "unknown" or "not attempted". An unfilled field can never
  read as success.
- `DrivetrainTelemetry.msg`: a timestamped list of `WheelTelemetry`, plus
  `hardware_active`. It lists only wheels the publisher has real information about.

## Service

- `ReadMotorDiagnostic.srv`: opt-in, read-only raw register probe for workshop
  bring-up (temperature, current, voltage). It never writes speed, direction or
  control words.

## Still to agree

Topic name, publish rate and which node publishes in production need sign-off from
the GUI team and Forrest (OI-04 / AD-18). Today the only publisher is the
diagnostics node, which reports its own read-only probe results; the hardware plugin
cannot be configured yet, so it publishes nothing.
