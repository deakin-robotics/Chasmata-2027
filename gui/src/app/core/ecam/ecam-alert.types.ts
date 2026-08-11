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
  | 'CAMERA_FRONT_LOST'
  | 'CONFIG_ANTENNA_NOT_DEPLOYED'
  | 'CONFIG_ARM_NOT_STOWED'
  | 'CONFIG_ESTOP_STATUS_UNAVAILABLE'
  | 'CONFIG_LAW_DIRECT'
  | 'DRIVE_CONTROLLER_OFFLINE'
  | 'LINK_DEGRADED'
  | 'LINK_LOST'
  | 'POWER_BATTERY_LOW'
  | 'SYSTEM_CRITICAL_FAULT';

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
