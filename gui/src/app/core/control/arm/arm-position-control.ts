import { Service, inject } from '@angular/core';

import { ArmIkCoordinator } from '../../arm/arm-ik-coordinator';
import { ArmPosition } from '../../arm/arm-ik-types';
import { GamepadSnapshot } from '../../gamepad/gamepad-input';

const POSITION_UPDATE_SECONDS = 0.02;
const POSITION_SPEED_METRES_PER_SECOND = 0.2;

/** Handles Position-mode gamepad input by updating the GUI IK target. */
@Service()
export class ArmPositionControl {
  private readonly armIkCoordinator = inject(ArmIkCoordinator);

  /** Applies one gamepad snapshot to the current IK target. */
  handle(snapshot: GamepadSnapshot): void {
    const leftStickX = this.finiteInput(snapshot.axes[0]);
    const leftStickY = this.finiteInput(snapshot.axes[1]);
    const dpadUp = this.finiteInput(snapshot.buttons[12]);
    const dpadDown = this.finiteInput(snapshot.buttons[13]);
    const delta: ArmPosition = [
      leftStickX * POSITION_SPEED_METRES_PER_SECOND * POSITION_UPDATE_SECONDS,
      -leftStickY * POSITION_SPEED_METRES_PER_SECOND * POSITION_UPDATE_SECONDS,
      (dpadUp - dpadDown) * POSITION_SPEED_METRES_PER_SECOND * POSITION_UPDATE_SECONDS,
    ];

    if (delta.some((coordinate) => coordinate !== 0)) {
      this.armIkCoordinator.translate(delta);
    }
  }

  private finiteInput(value: number | undefined): number {
    return value !== undefined && Number.isFinite(value) ? value : 0;
  }
}
