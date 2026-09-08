import { Service, signal } from '@angular/core';

import { ArmIkPose, ArmPosition } from './arm-ik-types';

const DEFAULT_ARM_POSITION: ArmPosition = [0, 0, 0];

/** Stores the shared end-effector position target for Arm Position mode. */
@Service()
export class ArmPositionTargetService {
  private readonly positionState = signal<ArmPosition>(DEFAULT_ARM_POSITION);

  /** Target position in the arm URDF base frame, measured in metres. */
  readonly position = this.positionState.asReadonly();

  /** Replaces the target position after validating its coordinates. */
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

  private assertFinitePosition(position: ArmPosition): void {
    if (position.length !== 3 || position.some((coordinate) => !Number.isFinite(coordinate))) {
      throw new Error('The arm position target must contain three finite coordinates.');
    }
  }
}
