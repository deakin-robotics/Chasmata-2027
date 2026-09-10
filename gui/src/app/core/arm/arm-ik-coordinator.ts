import { Service, computed, effect, inject, signal } from '@angular/core';

import { ArmIkSolver, DEFAULT_ARM_URDF_URL } from './arm-ik-solver';
import { ArmIkPose, ArmIkStatus, ArmPosition, ArmQuaternion } from './arm-ik-types';

const DEFAULT_ARM_POSITION: ArmPosition = [0, 0, 0];

/** Coordinates local IK state without publishing rover commands. */
@Service()
export class ArmIkCoordinator {
  private readonly armIkSolver = inject(ArmIkSolver);

  private readonly positionState = signal<ArmPosition>(DEFAULT_ARM_POSITION);
  private readonly statusState = signal<ArmIkStatus>('idle');
  private readonly jointAnglesState = signal<Readonly<Record<string, number>> | null>(null);

  readonly position = this.positionState.asReadonly();
  readonly status = this.statusState.asReadonly();
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

  private ikOrientation: ArmQuaternion | null = null;
  private ikReady = false;
  private targetInitialized = false;
  private solveTimer: ReturnType<typeof setTimeout> | null = null;
  private solveRequest = 0;
  private loadRequest = 0;

  private readonly targetEffect = effect(() => {
    const position = this.positionState();
    if (this.ikReady) this.scheduleSolve(position);
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

  /** Loads the arm model and begins solving the current target locally. */
  async load(url = DEFAULT_ARM_URDF_URL): Promise<void> {
    const request = ++this.loadRequest;
    this.cancelSolve();
    this.ikReady = false;
    this.ikOrientation = null;
    this.jointAnglesState.set(null);
    this.statusState.set('idle');

    try {
      await this.armIkSolver.load(url);

      if (request !== this.loadRequest) return;

      const endEffectorPose = this.armIkSolver.endEffectorPose();
      this.ikOrientation = endEffectorPose.orientation;
      if (!this.targetInitialized) this.setPosition(endEffectorPose.position);
      this.ikReady = true;
      this.scheduleSolve(this.positionState());
    } catch (error) {
      if (request === this.loadRequest) {
        this.ikReady = false;
        this.ikOrientation = null;
        this.jointAnglesState.set(null);
        this.statusState.set('invalid');
      }

      throw error;
    }
  }

  /** Stops IK work while preserving the operator's selected target. */
  reset(): void {
    this.loadRequest += 1;
    this.cancelSolve();
    this.ikReady = false;
    this.ikOrientation = null;
    this.jointAnglesState.set(null);
    this.statusState.set('idle');
  }

  private scheduleSolve(position: ArmPosition): void {
    const orientation = this.ikOrientation;
    if (!this.ikReady || !orientation) return;

    this.statusState.set('solving');
    this.cancelSolve();
    const request = ++this.solveRequest;
    this.solveTimer = setTimeout(() => {
      this.solveTimer = null;
      if (request !== this.solveRequest) return;

      this.solveTarget(position, orientation, request);
    }, 0);
  }

  private solveTarget(position: ArmPosition, orientation: ArmQuaternion, request: number): void {
    try {
      const result = this.armIkSolver.solve({ position, orientation });

      if (request !== this.solveRequest) return;

      if (result.status === 'converged') {
        this.jointAnglesState.set(result.jointAngles);
        this.statusState.set('valid');
        return;
      }

      this.jointAnglesState.set(null);
      this.statusState.set('unreachable');
    } catch {
      if (request !== this.solveRequest) return;

      this.jointAnglesState.set(null);
      this.statusState.set('invalid');
    }
  }

  private cancelSolve(): void {
    this.solveRequest += 1;
    if (this.solveTimer === null) return;

    clearTimeout(this.solveTimer);
    this.solveTimer = null;
  }

  private assertFinitePosition(position: ArmPosition): void {
    if (position.length !== 3 || position.some((coordinate) => !Number.isFinite(coordinate))) {
      throw new Error('The arm position target must contain three finite coordinates.');
    }
  }
}
