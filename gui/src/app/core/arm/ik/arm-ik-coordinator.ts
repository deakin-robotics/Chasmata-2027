import { Service, computed, effect, inject, signal } from '@angular/core';

import { ArmIkSolveService } from './arm-ik-solve.service';
import {
  ArmIkPose,
  ArmIkExecutionStatus,
  ArmIkSolveResult,
  ArmIkStatus,
  ArmOrientationMode,
  ArmPosition,
  ArmQuaternion,
  ArmTargetFrame,
} from './arm-ik-types';
import { ArmTelemetryService } from '../telemetry/arm-telemetry.service';

const DEFAULT_ARM_POSITION: ArmPosition = [0, 0, 0];

/** Coordinates the GUI target and delegates execution to MoveIt2. */
@Service()
export class ArmIkCoordinator {
  private readonly armIkSolveService = inject(ArmIkSolveService);
  private readonly armTelemetry = inject(ArmTelemetryService);

  private readonly positionState = signal<ArmPosition>(DEFAULT_ARM_POSITION);
  private readonly orientationState = signal<ArmQuaternion>([0, 0, 0, 1]);
  private readonly orientationModeState = signal<ArmOrientationMode>('unlocked');
  private readonly statusState = signal<ArmIkStatus>('idle');
  private readonly jointAnglesState = signal<Readonly<Record<string, number>> | null>(null);

  readonly position = this.positionState.asReadonly();
  readonly targetFrame = computed<ArmTargetFrame>(() => 'j4_pivot_link');
  readonly orientation = this.orientationState.asReadonly();
  readonly orientationMode = this.orientationModeState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly executionStatus = this.armIkSolveService.executionStatus;
  readonly jointAngles = this.jointAnglesState.asReadonly();
  readonly statusLabel = computed(() => {
    switch (this.statusState()) {
      case 'solving':
        return 'SOLVING';
      case 'valid':
        return 'VALID';
      case 'unreachable':
        return 'UNREACHABLE';
      case 'invalid':
        return 'INVALID';
      default:
        return 'WAITING';
    }
  });

  private ikReady = false;
  private targetInitialized = false;

  private readonly targetEffect = effect(() => {
    const position = this.positionState();
    if (this.ikReady) this.requestSolve(position);
  });

  /** Target position in the arm URDF base frame, measured in metres. */
  setPosition(position: ArmPosition): void {
    this.assertFinitePosition(position);
    this.positionState.set([...position] as ArmPosition);
  }

  /** Seeds the target from the arm's current forward-kinematics pose. */
  setFromPose(pose: ArmIkPose): void {
    this.setPosition(pose.position);
  }

  /** Moves the target by a delta in the arm URDF base frame. */
  translate(delta: ArmPosition): void {
    this.assertFinitePosition(delta);
    const current = this.positionState();
    this.setPosition([current[0] + delta[0], current[1] + delta[1], current[2] + delta[2]]);
  }

  /** Loads the arm model and begins solving the current target with MoveIt2. */
  async load(url?: string): Promise<void> {
    this.armIkSolveService.reset();
    this.ikReady = false;
    this.orientationState.set([0, 0, 0, 1]);
    this.orientationModeState.set('unlocked');
    this.jointAnglesState.set(null);
    this.statusState.set('idle');

    try {
      const endEffectorPose = await this.armIkSolveService.load(url);
      if (!endEffectorPose) return;

      this.orientationState.set(endEffectorPose.orientation);
      if (!this.targetInitialized) {
        this.setPosition(endEffectorPose.position);
        this.targetInitialized = true;
      }
      this.ikReady = true;
      this.requestSolve(this.positionState());
    } catch (error) {
      this.ikReady = false;
      this.orientationState.set([0, 0, 0, 1]);
      this.jointAnglesState.set(null);
      this.statusState.set('invalid');

      throw error;
    }
  }

  /** Stops IK work while preserving the operator's selected target. */
  reset(): void {
    this.armIkSolveService.reset();
    this.ikReady = false;
    this.orientationState.set([0, 0, 0, 1]);
    this.orientationModeState.set('unlocked');
    this.jointAnglesState.set(null);
    this.statusState.set('idle');
  }

  /** Switches MoveIt2's ownership of the wrist orientation. */
  setOrientationMode(mode: ArmOrientationMode): boolean {
    if (mode === this.orientationModeState()) return true;
    if (mode === 'locked') {
      const actualJointAngles = this.armTelemetry.actualJointAngles();
      if (!actualJointAngles || !this.hasCompleteJointState(actualJointAngles)) return false;

      const actualPose = this.armIkSolveService.poseFromJointAngles(actualJointAngles);
      if (!actualPose) return false;

      this.orientationState.set(actualPose.orientation);
    }

    this.orientationModeState.set(mode);
    if (this.ikReady) this.requestSolve(this.positionState());
    return true;
  }

  private requestSolve(position: ArmPosition): void {
    if (!this.ikReady) return;

    this.statusState.set('solving');
    this.armIkSolveService.solve({
      position,
      orientation: this.orientationState(),
      orientationMode: this.orientationModeState(),
    }).then(
      (result) => {
        if (result) this.applySolveResult(result);
      },
      () => this.finishSolve('invalid'),
    );
  }

  private finishSolve(status: 'unreachable' | 'invalid'): void {
    this.jointAnglesState.set(null);
    this.statusState.set(status);
  }

  private applySolveResult(result: ArmIkSolveResult): void {
    if (result.status === 'converged') {
      this.jointAnglesState.set(result.jointAngles);
      this.statusState.set('valid');
      return;
    }

    this.finishSolve('unreachable');
  }

  private assertFinitePosition(position: ArmPosition): void {
    if (position.length !== 3 || position.some((coordinate) => !Number.isFinite(coordinate))) {
      throw new Error('The arm position target must contain three finite coordinates.');
    }
  }

  private hasCompleteJointState(jointAngles: Readonly<Record<string, number>>): boolean {
    return [
      'base_joint',
      'shoulder_joint',
      'elbow_joint',
      'yaw_joint',
      'pitch_joint',
      'roll_joint',
    ].every((name) => Number.isFinite(jointAngles[name]));
  }

}
