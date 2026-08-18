/** Visual priority applied consistently anywhere an ECAM alert is rendered. */
export type EcamAlertSeverity = 'attention' | 'warning' | 'fault';

export type EcamAlertSource =
  | 'ARM'
  | 'CAMERA'
  | 'CONFIG'
  | 'DRIVE'
  | 'LINK'
  | 'POWER'
  | 'SYSTEM';

/** Stable identifiers used by features to raise and clear ECAM alerts. */
export type EcamAlertCode =
  | 'ARM_CAN_FAULT'
  | 'ARM_JOINT_FAULT'
  | 'ARM_JOINT_LIMIT'
  | 'ARM_OVERTEMPERATURE'
  | 'ARM_PLANNER_FAULT'
  | 'ARM_PLANNER_TIMEOUT'
  | 'ARM_POSITION_SENSOR_INVALID'
  | 'ARM_PROTECTION_UNAVAILABLE'
  | 'ARM_TELEMETRY_UNAVAILABLE'
  | 'CAMERA_ARM_LOST'
  | 'CAMERA_ARM_RECONNECT_FAILED'
  | 'CAMERA_ARM_STREAM_LOST'
  | 'CAMERA_FRONT_LOST'
  | 'CAMERA_FRONT_RECONNECT_FAILED'
  | 'CAMERA_FRONT_STREAM_LOST'
  | 'CAMERA_GIMBAL_LOST'
  | 'CAMERA_GIMBAL_RECONNECT_FAILED'
  | 'CAMERA_GIMBAL_STREAM_LOST'
  | 'CAMERA_LATENCY_HIGH'
  | 'CONFIG_ANTENNA_NOT_DEPLOYED'
  | 'CONFIG_ARM_NOT_STOWED'
  | 'CONFIG_ARM_NOT_READY'
  | 'CONFIG_CONTROLLER_NOT_CONNECTED'
  | 'CONFIG_DRIVE_NOT_READY'
  | 'CONFIG_ESTOP_ACTIVE'
  | 'CONFIG_ESTOP_STATUS_UNAVAILABLE'
  | 'CONFIG_LINK_NOT_READY'
  | 'CONFIG_LAW_DIRECT'
  | 'DRIVE_DRIVETRAIN_FAULT'
  | 'DRIVE_CONTROLLER_OFFLINE'
  | 'DRIVE_FL_OVERCURRENT'
  | 'DRIVE_FR_OVERCURRENT'
  | 'DRIVE_RL_OVERCURRENT'
  | 'DRIVE_RR_OVERCURRENT'
  | 'DRIVE_FL_OVERTEMPERATURE'
  | 'DRIVE_FR_OVERTEMPERATURE'
  | 'DRIVE_RL_OVERTEMPERATURE'
  | 'DRIVE_RR_OVERTEMPERATURE'
  | 'DRIVE_FL_MOTION_MISMATCH'
  | 'DRIVE_FR_MOTION_MISMATCH'
  | 'DRIVE_RL_MOTION_MISMATCH'
  | 'DRIVE_RR_MOTION_MISMATCH'
  | 'DRIVE_FL_MOTOR_FAULT'
  | 'DRIVE_FR_MOTOR_FAULT'
  | 'DRIVE_RL_MOTOR_FAULT'
  | 'DRIVE_RR_MOTOR_FAULT'
  | 'DRIVE_RS485_FAULT'
  | 'DRIVE_TELEMETRY_UNAVAILABLE'
  | 'GIMBAL_CONTROL_FAULT'
  | 'GIMBAL_POSITION_UNKNOWN'
  | 'GIMBAL_PRIORITY_UNKNOWN'
  | 'LINK_DEGRADED'
  | 'LINK_CONTROLLER_DISCONNECTED'
  | 'LINK_LATENCY_HIGH'
  | 'LINK_LOST'
  | 'LINK_PACKET_LOSS_HIGH'
  | 'LINK_ROS_UNAVAILABLE'
  | 'POWER_BATTERY_LOW'
  | 'POWER_BATTERY_UNAVAILABLE'
  | 'POWER_RAIL_FAULT'
  | 'POWER_TOTAL_POWER_UNAVAILABLE'
  | 'SYSTEM_CPU_HIGH'
  | 'SYSTEM_CRITICAL_FAULT'
  | 'SYSTEM_DIAGNOSTICS_UNAVAILABLE'
  | 'SYSTEM_ESTOP_ACTIVE'
  | 'SYSTEM_LED_FAULT'
  | 'SYSTEM_MEMORY_HIGH'
  | 'SYSTEM_ROS_NODE_FAULT'
  | 'SYSTEM_ROS_SERVICE_UNAVAILABLE'
  | 'SYSTEM_STORAGE_LOW'
  | 'SYSTEM_TELEMETRY_STALE'
  | 'SYSTEM_TEMPERATURE_HIGH'
  | 'SYSTEM_WATCHDOG_FAULT';

/** A remotely actionable troubleshooting step for an ECAM message. */
export interface EcamProcedureStep {
  id: string;
  instruction: string;
}

/** Optional operator procedure attached to an alert definition. */
export interface EcamProcedure {
  steps: readonly EcamProcedureStep[];
}

/** Static definition for one known ECAM alert. */
export interface EcamAlertDefinition {
  code: EcamAlertCode;
  procedure?: EcamProcedure;
  source: EcamAlertSource;
  severity: EcamAlertSeverity;
  text: string;
}

/** A currently active alert, ready for presentation in an operator view. */
export interface EcamAlert extends EcamAlertDefinition {
  detail: string | null;
  firstSeenAt: number;
  lastUpdatedAt: number;
}

/** Optional contextual information supplied when an alert is raised. */
export interface RaiseEcamAlertOptions {
  detail?: string;
}
