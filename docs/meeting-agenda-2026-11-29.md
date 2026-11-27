# Software Team Meeting Agenda

## 1. Sub-team Progress Report

## 2. Gimbal Control

- Discuss the driver needed for gimbal control.

## 3. Camera Work Handover

- Camera work is complete.
- Hand over the camera work to Control. Remaining step is to wire GStreamer to the real cameras once they are installed on the rover.

## 4. Drivetrain and Arm Telemetry

- Drivetrain and arm telemetry is implemented.
- Need Control team to double-check the telemetry integration before mergring to main

## 5. ECAM Training

- Provide general ECAM training, including how to raise and clear codes.

- Use the Rover heartbeat as an example: the BaseStation raises `ROVER_HEARTBEAT_LOST` when the heartbeat times out and clears it when the heartbeat returns.

The BaseStation aggregator creates one `EcamAlertSource` for its alerts and reuses it:

```cpp
base_station_alerts_ = std::make_unique<EcamAlertSource>(*this, "basestation");

// When the Rover heartbeat times out:
base_station_alerts_->raise_alert(kRoverHeartbeatLost);

// When the Rover heartbeat returns:
base_station_alerts_->clear(kRoverHeartbeatLost);
```

