import { Service, computed, effect, inject, signal } from '@angular/core';

import { ArmIkSolveService } from './arm-ik-solve.service';
import {
  ArmIkPose,
  ArmIkSolveResult,
  ArmIkStatus,
  ArmPosition,
  ArmQuaternion,
} from './arm-ik-types';

const DEFAULT_ARM_POSITION: ArmPosition = [0, 0, 0];

/** Contract shared by the local closed-chain and MoveIt2 providers. */
export interface ArmIkProvider {
  solve(target: ArmIkPose): ArmIkSolveResult | Promise<ArmIkSolveResult>;
  reset?(): void;
}

export type ArmIkProviderName = 'closed-chain-ik' | 'moveit2';

/** Coordinates the shared target and delegates solving to the selected provider. */
@Service()
export class ArmIkCoordinator {
  private readonly armIkSolveService = inject(ArmIkSolveService);

  private readonly positionState = signal<ArmPosition>(DEFAULT_ARM_POSITION);
  private readonly statusState = signal<ArmIkStatus>('idle');
  private readonly jointAnglesState = signal<Readonly<Record<string, number>> | null>(null);

  readonly position = this.positionState.asReadonly();
  readonly provider = this.armIkSolveService.provider;
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

  private readonly targetEffect = effect(() => {
    const position = this.positionState();
    if (this.ikReady) this.requestSolve(position);
  });

  /** Target position in the arm URDF base frame, measured in metres. */
  setPosition(position: ArmPosition): void {
    this.assertFinitePosition(position);
    this.positionState.set([...position] as ArmPosition);
  }

  /** Selects the interchangeable provider used to solve Position-mode targets. */
  setProvider(provider: ArmIkProviderName): void {
    if (provider === this.provider()) return;

    this.armIkSolveService.setProvider(provider);
    this.jointAnglesState.set(null);
    this.statusState.set('idle');

    if (this.ikReady) this.requestSolve(this.positionState());
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

  /** Loads the arm model and begins solving the current target with the selected provider. */
  async load(url?: string): Promise<void> {
    this.armIkSolveService.reset();
    this.ikReady = false;
    this.ikOrientation = null;
    this.jointAnglesState.set(null);
    this.statusState.set('idle');

    try {
      const endEffectorPose = await this.armIkSolveService.load(url);
      if (!endEffectorPose) return;

      this.ikOrientation = endEffectorPose.orientation;
      if (!this.targetInitialized) {
        this.setPosition(endEffectorPose.position);
        this.targetInitialized = true;
      }
      this.ikReady = true;
      this.requestSolve(this.positionState());
    } catch (error) {
      this.ikReady = false;
      this.ikOrientation = null;
      this.jointAnglesState.set(null);
      this.statusState.set('invalid');

      throw error;
    }
  }

  /** Stops IK work while preserving the operator's selected target. */
  reset(): void {
    this.armIkSolveService.reset();
    this.ikReady = false;
    this.ikOrientation = null;
    this.jointAnglesState.set(null);
    this.statusState.set('idle');
  }

  private requestSolve(position: ArmPosition): void {
    const orientation = this.ikOrientation;
    if (!this.ikReady || !orientation) return;

    this.statusState.set('solving');
    this.armIkSolveService.solve({ position, orientation }).then(
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
}
