export type ArmPosition = readonly [number, number, number];
export type ArmQuaternion = readonly [number, number, number, number];
export type ArmOrientationMode = 'locked' | 'unlocked';
export type ArmTargetFrame = 'j4_pivot_link';

export interface ArmIkPose {
  position: ArmPosition;
  orientation: ArmQuaternion;
  orientationMode?: ArmOrientationMode;
}

export interface ArmJointState {
  names: readonly string[];
  positions: readonly number[];
  velocities?: readonly number[];
}

export interface ArmJointLimit {
  lower: number;
  upper: number;
}

export type ArmIkSolveStatus = 'converged' | 'stalled' | 'diverged' | 'timeout';

export type ArmIkStatus = 'idle' | 'solving' | 'valid' | 'unreachable' | 'invalid';

export type ArmIkExecutionStatus =
  | 'idle'
  | 'planning'
  | 'executing'
  | 'succeeded'
  | 'canceled'
  | 'failed';

export interface ArmIkSolveResult {
  status: ArmIkSolveStatus;
  jointAngles: Readonly<Record<string, number>>;
}
