import { Service, inject } from '@angular/core';

import { GamepadSnapshot } from '../../gamepad/gamepad-input';
import { ArmCommandPublisher } from './arm-command-publisher';

/** Handles the direct-joint Arm mapping and its ROS command publisher. */
@Service()
export class ArmManualControl {
  private readonly publisher = inject(ArmCommandPublisher);

  /** Publishes one gamepad snapshot through the manual Arm mapping. */
  handle(snapshot: GamepadSnapshot): void {
    this.publisher.publish(snapshot);
  }

  /** Sends a zeroed manual command without releasing Arm authority. */
  stop(): void {
    this.publisher.publishStop();
  }

  /** Stops manual output and releases Arm control authority. */
  release(): void {
    this.publisher.releaseArmControl();
  }
}
