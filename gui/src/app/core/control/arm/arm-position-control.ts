import { Service, inject } from '@angular/core';

import { ArmIkCoordinator } from '../../arm/ik/arm-ik-coordinator';
import { ArmViewModeService } from '../../arm/arm-view-mode';
import { ArmPosition } from '../../arm/ik/arm-ik-types';
import { GamepadSnapshot } from '../../gamepad/gamepad-input';
import { ArmCommandPublisher } from './arm-command-publisher';

const POSITION_UPDATE_SECONDS = 0.02;
const POSITION_SPEED_METRES_PER_SECOND = 0.2;

/** Handles Position-mode gamepad input for the MoveIt2 pivot and unlocked wrist. */
@Service()
export class ArmPositionControl {
  private readonly armIkCoordinator = inject(ArmIkCoordinator);
  private readonly armCommandPublisher = inject(ArmCommandPublisher);
  private readonly armViewMode = inject(ArmViewModeService);

  /** Applies one gamepad snapshot to the current IK target. */
  handle(snapshot: GamepadSnapshot): void {
    const dpadX = this.finiteInput(snapshot.buttons[15]) - this.finiteInput(snapshot.buttons[14]);
    const dpadY = this.finiteInput(snapshot.buttons[12]) - this.finiteInput(snapshot.buttons[13]);
    const delta = this.targetDelta(dpadX, dpadY);

    if (delta.some((coordinate) => coordinate !== 0)) {
      this.armIkCoordinator.translate(delta);
    }

    if (this.armIkCoordinator.orientationMode() === 'locked') {
      this.armCommandPublisher.publishPositionButtons(snapshot);
      return;
    }

    this.armCommandPublisher.publishPositionWrist(snapshot);
  }

  private finiteInput(value: number | undefined): number {
    return value !== undefined && Number.isFinite(value) ? value : 0;
  }

  private targetDelta(leftStickX: number, leftStickY: number): ArmPosition {
    const amount = POSITION_SPEED_METRES_PER_SECOND * POSITION_UPDATE_SECONDS;

    if (this.armViewMode.view() === 'top') {
      return [leftStickX * amount, leftStickY * amount, 0];
    }

    // Side view looks along the arm's X axis, so the visible plane is Y-Z.
    // Positive screen X points toward negative model Y from this camera.
    return [0, leftStickX === 0 ? 0 : -leftStickX * amount, leftStickY * amount];
  }

}
