import { Service, inject } from '@angular/core';

import { GamepadSnapshot } from '../../gamepad/gamepad-input';
import { ArmCommandPublisher } from './arm-command-publisher';

const LEFT_BUMPER_BUTTON_INDEX = 4;

/** Handles the direct-joint Arm mapping and its ROS command publisher. */
@Service()
export class ArmManualControl {
  private readonly publisher = inject(ArmCommandPublisher);

  /** Publishes one gamepad snapshot through the manual Arm mapping. */
  handle(snapshot: GamepadSnapshot): void {
    this.publisher.publish(this.publisher.createCommand(snapshot, this.toAxes(snapshot)));
  }

  /** Sends a zeroed manual command without releasing Arm authority. */
  stop(): void {
    this.publisher.publishStop();
  }

  /** Stops manual output and releases Arm control authority. */
  release(): void {
    this.publisher.releaseArmControl();
  }

  private toAxes(snapshot: GamepadSnapshot): readonly number[] {
    const rawAxes = snapshot.axes;
    const rawButtons = snapshot.buttons;
    const dpadY = (rawButtons[12] ?? 0) - (rawButtons[13] ?? 0);
    const rightStickX = -(rawAxes[2] ?? 0);
    const rightStickY = -(rawAxes[3] ?? 0);
    const gimbalHeld = (rawButtons[LEFT_BUMPER_BUTTON_INDEX] ?? 0) > 0.5;

    return [
      gimbalHeld ? 0 : rightStickX,
      gimbalHeld ? 0 : rightStickY,
      0,
      gimbalHeld ? rightStickX : 0,
      gimbalHeld ? rightStickY : dpadY,
      0,
      rawAxes[0] ?? 0,
      -(rawAxes[1] ?? 0),
      0,
      0,
    ];
  }
}
