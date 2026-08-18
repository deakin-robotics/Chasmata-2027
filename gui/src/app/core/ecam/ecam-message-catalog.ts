import { EcamAlertCode, EcamAlertDefinition } from './ecam-alert.types';

/**
 * The single source of truth for ECAM message wording, source, and severity.
 * Features raise stable codes; they do not choose colours or user-facing text.
 */
export const ECAM_MESSAGE_CATALOG: Readonly<Record<EcamAlertCode, EcamAlertDefinition>> = {
  CAMERA_FRONT_LOST: {
    code: 'CAMERA_FRONT_LOST',
    source: 'CAMERA',
    severity: 'attention',
    text: 'FRONT CAMERA LOST',
  },
  CONFIG_ANTENNA_NOT_DEPLOYED: {
    code: 'CONFIG_ANTENNA_NOT_DEPLOYED',
    source: 'CONFIG',
    severity: 'attention',
    text: 'CONFIG ANTENNA NOT DEPLOYED',
  },
  CONFIG_ARM_NOT_STOWED: {
    code: 'CONFIG_ARM_NOT_STOWED',
    source: 'CONFIG',
    severity: 'attention',
    text: 'CONFIG ARM NOT STOWED',
  },
  CONFIG_ESTOP_STATUS_UNAVAILABLE: {
    code: 'CONFIG_ESTOP_STATUS_UNAVAILABLE',
    source: 'CONFIG',
    severity: 'fault',
    text: 'CONFIG E-STOP STATUS UNAVAILABLE',
  },
  CONFIG_LAW_DIRECT: {
    code: 'CONFIG_LAW_DIRECT',
    procedure: {
      steps: [
        { id: 'confirm-authority', instruction: 'CONFIRM DIRECT AUTHORISED' },
        { id: 'confirm-clearance', instruction: 'CONFIRM ROVER STATIONARY AND ARM AREA CLEAR' },
        { id: 'operate-visually', instruction: 'OPERATE UNDER DIRECT VISUAL SUPERVISION' },
        { id: 'restore-normal', instruction: 'RESTORE LAW NORMAL' },
        { id: 'do-not-depart', instruction: 'DO NOT DEPART IF UNABLE' },
      ],
    },
    source: 'CONFIG',
    severity: 'warning',
    text: 'CONFIG LAW DIRECT',
  },
  DRIVE_CONTROLLER_OFFLINE: {
    code: 'DRIVE_CONTROLLER_OFFLINE',
    procedure: {
      steps: [
        { id: 'check-link', instruction: 'CONFIRM LINK GOOD' },
        { id: 'retry-controller', instruction: 'RETRY DRIVE-CONTROLLER CONNECTION' },
        { id: 'confirm-heartbeat', instruction: 'CONFIRM DRIVE-CONTROLLER HEARTBEAT' },
        { id: 'stop-driving', instruction: 'DO NOT DRIVE IF UNRESOLVED' },
      ],
    },
    source: 'DRIVE',
    severity: 'fault',
    text: 'DRIVE CONTROLLER OFFLINE',
  },
  LINK_DEGRADED: {
    code: 'LINK_DEGRADED',
    source: 'LINK',
    severity: 'warning',
    text: 'LINK DEGRADED',
  },
  LINK_LOST: {
    code: 'LINK_LOST',
    source: 'LINK',
    severity: 'fault',
    text: 'LINK LOST',
  },
  POWER_BATTERY_LOW: {
    code: 'POWER_BATTERY_LOW',
    source: 'POWER',
    severity: 'warning',
    text: 'BATTERY LOW',
  },
  SYSTEM_CRITICAL_FAULT: {
    code: 'SYSTEM_CRITICAL_FAULT',
    source: 'SYSTEM',
    severity: 'fault',
    text: 'SYSTEM CRITICAL FAULT',
  },
};
