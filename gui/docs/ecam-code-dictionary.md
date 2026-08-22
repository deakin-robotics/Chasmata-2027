# Electronic Centralized Advisory Monitor (ECAM) Code Dictionary

This document defines the stable ECAM alert codes available to the rover and
GUI. Control should return a code from this dictionary when the corresponding
condition is active.

Each code has a stable identifier, source subsystem, severity, display text,
and meaning. The GUI uses the identifier to resolve the message shown to the
operator.

## Delivery

ECAM codes are sent as a complete active-code set. The rover publishes the
current set immediately when it changes and includes it in the complete 1 Hz
recovery snapshot. A code absent from a newer complete set is cleared by the
GUI.

The `T/O CONFIG` response may contain the applicable codes from this
dictionary in its `ecam_codes` array. The overall result remains separate from
the individual condition codes.

Operational procedures are not defined by this dictionary. Procedure content
will be added after the responsible leads confirm the required operator steps.

## Codes

| Code | Source | Severity | Display text | Meaning |
|---|---|---|---|---|
| `ARM_CAN_FAULT` | ARM | fault | ARM CAN FAULT | Communication fault reported on the arm CAN interface. |
| `ARM_JOINT_FAULT` | ARM | fault | ARM JOINT FAULT | One or more arm joints report a fault. |
| `ARM_JOINT_LIMIT` | ARM | warning | ARM JOINT LIMIT | An arm joint reports a configured limit condition. |
| `ARM_OVERTEMPERATURE` | ARM | warning | ARM OVERTEMPERATURE | Arm motor or joint temperature is above its permitted range. |
| `ARM_PLANNER_FAULT` | ARM | fault | ARM PLANNER FAULT | The arm motion planner reports a fault. |
| `ARM_PLANNER_TIMEOUT` | ARM | warning | ARM PLANNER TIMEOUT | The arm motion planner does not complete within its allowed time. |
| `ARM_POSITION_SENSOR_INVALID` | ARM | fault | ARM POSITION SENSOR INVALID | Arm joint-position feedback is invalid, stale, or out of range. |
| `ARM_PROTECTION_UNAVAILABLE` | ARM | warning | ARM PROTECTION UNAVAILABLE | Required arm protection is unavailable. |
| `ARM_TELEMETRY_UNAVAILABLE` | ARM | warning | ARM TELEMETRY UNAVAILABLE | Required arm telemetry is unavailable or stale. |
| `CAMERA_ARM_LOST` | CAMERA | attention | ARM CAMERA LOST | The Arm camera is unavailable. |
| `CAMERA_ARM_RECONNECT_FAILED` | CAMERA | warning | ARM CAMERA RECONNECT FAILED | Reconnection to the Arm camera has failed. |
| `CAMERA_ARM_STREAM_LOST` | CAMERA | warning | ARM CAMERA STREAM LOST | The Arm camera is available but its video stream is unavailable. |
| `CAMERA_FRONT_LOST` | CAMERA | attention | FRONT CAMERA LOST | The Front camera is unavailable. |
| `CAMERA_FRONT_RECONNECT_FAILED` | CAMERA | warning | FRONT CAMERA RECONNECT FAILED | Reconnection to the Front camera has failed. |
| `CAMERA_FRONT_STREAM_LOST` | CAMERA | warning | FRONT CAMERA STREAM LOST | The Front camera is available but its video stream is unavailable. |
| `CAMERA_GIMBAL_LOST` | CAMERA | attention | GIMBAL CAMERA LOST | The Gimbal camera is unavailable. |
| `CAMERA_GIMBAL_RECONNECT_FAILED` | CAMERA | warning | GIMBAL CAMERA RECONNECT FAILED | Reconnection to the Gimbal camera has failed. |
| `CAMERA_GIMBAL_STREAM_LOST` | CAMERA | warning | GIMBAL CAMERA STREAM LOST | The Gimbal camera is available but its video stream is unavailable. |
| `CAMERA_LATENCY_HIGH` | CAMERA | warning | CAMERA LATENCY HIGH | Camera latency exceeds the configured acceptable range. |
| `GIMBAL_CONTROL_FAULT` | CAMERA | fault | GIMBAL CONTROL FAULT | The Gimbal control system reports a fault. |
| `GIMBAL_POSITION_UNKNOWN` | CAMERA | warning | GIMBAL POSITION UNKNOWN | The authoritative Gimbal position is unavailable or stale. |
| `GIMBAL_PRIORITY_UNKNOWN` | CAMERA | warning | GIMBAL PRIORITY UNKNOWN | The authoritative Gimbal owner is unavailable or stale. |
| `CONFIG_ANTENNA_NOT_DEPLOYED` | CONFIG | attention | CONFIG ANTENNA NOT DEPLOYED | The required antenna is not deployed for the configuration check. |
| `CONFIG_ARM_NOT_STOWED` | CONFIG | attention | CONFIG ARM NOT STOWED | The arm is not in its required stowed configuration. |
| `CONFIG_ARM_NOT_READY` | CONFIG | warning | CONFIG ARM NOT READY | The arm is not ready for the requested operation. |
| `CONFIG_CONTROLLER_NOT_CONNECTED` | CONFIG | warning | CONFIG CONTROLLER NOT CONNECTED | A required controller is not connected. |
| `CONFIG_DRIVE_NOT_READY` | CONFIG | warning | CONFIG DRIVE NOT READY | The drive system is not ready for the requested operation. |
| `CONFIG_ESTOP_ACTIVE` | CONFIG | fault | CONFIG E-STOP ACTIVE | E-stop is active during the configuration check. |
| `CONFIG_ESTOP_STATUS_UNAVAILABLE` | CONFIG | fault | CONFIG E-STOP STATUS UNAVAILABLE | The configuration check cannot confirm E-stop status. |
| `CONFIG_LINK_NOT_READY` | CONFIG | warning | CONFIG LINK NOT READY | The required communication link is not ready. |
| `CONFIG_LAW_DIRECT` | CONFIG | warning | CONFIG LAW DIRECT | The arm protection law is in DIRECT during the configuration check. |
| `DRIVE_CONTROLLER_OFFLINE` | DRIVE | fault | DRIVE CONTROLLER OFFLINE | The drive controller is offline or its heartbeat is absent. |
| `DRIVE_DRIVETRAIN_FAULT` | DRIVE | fault | DRIVETRAIN FAULT | The drivetrain reports a fault. |
| `DRIVE_FL_OVERCURRENT` | DRIVE | fault | FL MOTOR OVERCURRENT | The front-left drive motor reports an overcurrent condition. |
| `DRIVE_FR_OVERCURRENT` | DRIVE | fault | FR MOTOR OVERCURRENT | The front-right drive motor reports an overcurrent condition. |
| `DRIVE_RL_OVERCURRENT` | DRIVE | fault | RL MOTOR OVERCURRENT | The rear-left drive motor reports an overcurrent condition. |
| `DRIVE_RR_OVERCURRENT` | DRIVE | fault | RR MOTOR OVERCURRENT | The rear-right drive motor reports an overcurrent condition. |
| `DRIVE_FL_OVERTEMPERATURE` | DRIVE | warning | FL MOTOR OVERTEMPERATURE | The front-left drive motor reports an overtemperature condition. |
| `DRIVE_FR_OVERTEMPERATURE` | DRIVE | warning | FR MOTOR OVERTEMPERATURE | The front-right drive motor reports an overtemperature condition. |
| `DRIVE_RL_OVERTEMPERATURE` | DRIVE | warning | RL MOTOR OVERTEMPERATURE | The rear-left drive motor reports an overtemperature condition. |
| `DRIVE_RR_OVERTEMPERATURE` | DRIVE | warning | RR MOTOR OVERTEMPERATURE | The rear-right drive motor reports an overtemperature condition. |
| `DRIVE_FL_MOTION_MISMATCH` | DRIVE | warning | FL MOTION MISMATCH | Front-left actual wheel motion does not match its commanded motion. |
| `DRIVE_FR_MOTION_MISMATCH` | DRIVE | warning | FR MOTION MISMATCH | Front-right actual wheel motion does not match its commanded motion. |
| `DRIVE_RL_MOTION_MISMATCH` | DRIVE | warning | RL MOTION MISMATCH | Rear-left actual wheel motion does not match its commanded motion. |
| `DRIVE_RR_MOTION_MISMATCH` | DRIVE | warning | RR MOTION MISMATCH | Rear-right actual wheel motion does not match its commanded motion. |
| `DRIVE_FL_MOTOR_FAULT` | DRIVE | fault | FL MOTOR FAULT | The front-left drive motor reports a fault. |
| `DRIVE_FR_MOTOR_FAULT` | DRIVE | fault | FR MOTOR FAULT | The front-right drive motor reports a fault. |
| `DRIVE_RL_MOTOR_FAULT` | DRIVE | fault | RL MOTOR FAULT | The rear-left drive motor reports a fault. |
| `DRIVE_RR_MOTOR_FAULT` | DRIVE | fault | RR MOTOR FAULT | The rear-right drive motor reports a fault. |
| `DRIVE_RS485_FAULT` | DRIVE | fault | DRIVE RS485 FAULT | The drive RS485 communication interface reports a fault. |
| `DRIVE_TELEMETRY_UNAVAILABLE` | DRIVE | warning | DRIVE TELEMETRY UNAVAILABLE | Required drive telemetry is unavailable or stale. |
| `LINK_DEGRADED` | LINK | warning | LINK DEGRADED | The communication link remains usable but is degraded. |
| `LINK_CONTROLLER_DISCONNECTED` | LINK | fault | CONTROLLER DISCONNECTED | A required controller connection is lost. |
| `LINK_LATENCY_HIGH` | LINK | warning | LINK LATENCY HIGH | Network latency exceeds the configured acceptable range. |
| `LINK_LOST` | LINK | fault | LINK LOST | The rover/base-station communication link is lost. |
| `LINK_PACKET_LOSS_HIGH` | LINK | warning | LINK PACKET LOSS HIGH | Packet loss exceeds the configured acceptable range. |
| `LINK_ROS_UNAVAILABLE` | LINK | fault | LINK ROS UNAVAILABLE | Required ROS communication over the link is unavailable. |
| `POWER_BATTERY_LOW` | POWER | warning | BATTERY LOW | Battery state is below the configured operating threshold. |
| `POWER_BATTERY_UNAVAILABLE` | POWER | fault | BATTERY DATA UNAVAILABLE | Required battery telemetry is unavailable or invalid. |
| `POWER_RAIL_FAULT` | POWER | fault | POWER RAIL FAULT | A monitored power rail reports a fault. |
| `POWER_TOTAL_POWER_UNAVAILABLE` | POWER | warning | TOTAL POWER UNAVAILABLE | Total system-power telemetry is unavailable. |
| `SYSTEM_CPU_HIGH` | SYSTEM | warning | CPU LOAD HIGH | CPU usage exceeds the configured acceptable range. |
| `SYSTEM_CRITICAL_FAULT` | SYSTEM | fault | SYSTEM CRITICAL FAULT | The system reports a critical fault requiring operator attention. |
| `SYSTEM_DIAGNOSTICS_UNAVAILABLE` | SYSTEM | warning | SYSTEM DIAGNOSTICS UNAVAILABLE | Required system diagnostics are unavailable. |
| `SYSTEM_ESTOP_ACTIVE` | SYSTEM | fault | E-STOP ACTIVE | The rover E-stop is active. |
| `SYSTEM_LED_FAULT` | SYSTEM | warning | LED FAULT | A monitored system LED reports a fault. |
| `SYSTEM_MEMORY_HIGH` | SYSTEM | warning | MEMORY USE HIGH | Memory usage exceeds the configured acceptable range. |
| `SYSTEM_ROS_NODE_FAULT` | SYSTEM | fault | ROS NODE FAULT | A required ROS node reports a fault. |
| `SYSTEM_ROS_SERVICE_UNAVAILABLE` | SYSTEM | fault | ROS SERVICE UNAVAILABLE | A required ROS service is unavailable. |
| `SYSTEM_STORAGE_LOW` | SYSTEM | warning | STORAGE LOW | Available system storage is below the configured threshold. |
| `SYSTEM_TELEMETRY_STALE` | SYSTEM | warning | SYSTEM TELEMETRY STALE | Required system telemetry is stale. |
| `SYSTEM_TEMPERATURE_HIGH` | SYSTEM | warning | SYSTEM TEMPERATURE HIGH | System temperature exceeds the configured acceptable range. |
| `SYSTEM_WATCHDOG_FAULT` | SYSTEM | fault | SYSTEM WATCHDOG FAULT | The system watchdog reports a fault. |
