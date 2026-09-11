export type ArmPosition = readonly [number, number, number];
export type ArmQuaternion = readonly [number, number, number, number];

export interface ArmIkPose {
  position: ArmPosition;
  orientation: ArmQuaternion;
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

export interface ArmIkSolveResult {
  status: ArmIkSolveStatus;
  jointAngles: Readonly<Record<string, number>>;
}
