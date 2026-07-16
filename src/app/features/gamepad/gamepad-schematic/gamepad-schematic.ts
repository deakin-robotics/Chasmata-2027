import { Component, inject } from '@angular/core';

import { PilotDriveControl } from '../../../core/control/pilot/pilot-drive-control';
import { GamepadInput } from '../../../core/gamepad/gamepad-input';

/** Visualises browser controller input. */
@Component({
  selector: 'app-gamepad-schematic',
  templateUrl: './gamepad-schematic.html',
  styleUrl: './gamepad-schematic.scss',
})
export class GamepadSchematic {
  private readonly gamepad = inject(GamepadInput);
  private readonly pilotDriveControl = inject(PilotDriveControl);

  /** Indicates that authorised Pilot commands are currently being published. */
  readonly isCommandPublishing = this.pilotDriveControl.canDrive;

  constructor() {
    this.gamepad.start();
  }

  /** Returns the current value for a browser gamepad axis. */
  axis(index: number): number {
    return this.gamepad.snapshot()?.axes[index] ?? 0;
  }

  /** Returns whether a browser gamepad button is currently pressed. */
  isButtonPressed(index: number): boolean {
    return (this.gamepad.snapshot()?.buttons[index] ?? 0) > 0;
  }

  /** Returns whether either axis of a stick is currently deflected. */
  isStickMoved(horizontalAxis: number, verticalAxis: number): boolean {
    return this.axis(horizontalAxis) !== 0 || this.axis(verticalAxis) !== 0;
  }

  /** Converts a normalised stick axis into a small SVG offset. */
  stickOffset(index: number): number {
    return this.axis(index) * 9;
  }
}
