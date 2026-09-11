import { Service, inject } from '@angular/core';

import { ArmIkCoordinator } from '../../arm/ik/arm-ik-coordinator';
import { ArmViewModeService } from '../../arm/arm-view-mode';
import { ArmOrientationDelta, ArmPosition } from '../../arm/ik/arm-ik-types';
import { GamepadSnapshot } from '../../gamepad/gamepad-input';
import { ArmCommandPublisher } from './arm-command-publisher';

const POSITION_UPDATE_SECONDS = 0.02;
const POSITION_SPEED_METRES_PER_SECOND = 0.2;
const ORIENTATION_SPEED_RADIANS_PER_SECOND = Math.PI / 6;

/** Handles Position-mode gamepad input by updating the GUI IK target. */
@Service()
export class ArmPositionControl {
  private readonly armIkCoordinator = inject(ArmIkCoordinator);
  private readonly armCommandPublisher = inject(ArmCommandPublisher);
  private readonly armViewMode = inject(ArmViewModeService);

  /** Applies one gamepad snapshot to the current IK target. */
  handle(snapshot: GamepadSnapshot): void {
    const leftStickX = this.finiteInput(snapshot.axes[0]);
    const leftStickY = this.finiteInput(snapshot.axes[1]);
    const provider = this.armIkCoordinator.provider?.();
    const delta = provider === 'moveit2'
      ? this.targetDelta(leftStickX, leftStickY)
      : this.legacyTargetDelta(leftStickX, leftStickY, snapshot);

    if (delta.some((coordinate) => coordinate !== 0)) {
      this.armIkCoordinator.translate(delta);
    }

    if (provider !== 'moveit2') return;

    if (this.armIkCoordinator.orientationMode() === 'locked') {
      this.armIkCoordinator.adjustOrientation(this.orientationDelta(snapshot));
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
      return [leftStickX * amount, -leftStickY * amount, 0];
    }

    // Side view looks along the arm's X axis, so the visible plane is Y-Z.
    // Positive screen X points toward negative model Y from this camera.
    return [0, -leftStickX * amount, -leftStickY * amount];
  }

  private legacyTargetDelta(
    leftStickX: number,
    leftStickY: number,
    snapshot: GamepadSnapshot,
  ): ArmPosition {
    const amount = POSITION_SPEED_METRES_PER_SECOND * POSITION_UPDATE_SECONDS;
    const dpadUp = this.finiteInput(snapshot.buttons[12]);
    const dpadDown = this.finiteInput(snapshot.buttons[13]);

    return [
      leftStickX * amount,
      -leftStickY * amount,
      (dpadDown - dpadUp) * amount,
    ];
  }

  private orientationDelta(snapshot: GamepadSnapshot): ArmOrientationDelta {
    const amount = ORIENTATION_SPEED_RADIANS_PER_SECOND * POSITION_UPDATE_SECONDS;
    const dpadX = this.finiteInput(snapshot.buttons[15]) - this.finiteInput(snapshot.buttons[14]);
    const dpadY = this.finiteInput(snapshot.buttons[12]) - this.finiteInput(snapshot.buttons[13]);
    const leftTrigger = this.finiteInput(snapshot.buttons[6]);
    const rightTrigger = this.finiteInput(snapshot.buttons[7]);

    return {
      roll: (leftTrigger - rightTrigger) * amount,
      pitch: dpadY * amount,
      yaw: dpadX * amount,
    };
  }
}
