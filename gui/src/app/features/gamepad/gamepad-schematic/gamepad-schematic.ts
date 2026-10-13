import { Component, inject } from '@angular/core';

import { GamepadInput } from '../../../core/gamepad/gamepad-input';

/** Visualises browser controller input. */
@Component({
  selector: 'app-gamepad-schematic',
  templateUrl: './gamepad-schematic.html',
  styleUrl: './gamepad-schematic.scss',
})
export class GamepadSchematic {
  private readonly gamepad = inject(GamepadInput);


  constructor() {
    this.gamepad.start();
  }

  /** Returns the current value for a browser gamepad axis. */
  axis(index: number): number {
    return this.gamepad.snapshot()?.axes[index] ?? 0;
  }

  /** Returns whether a browser gamepad button is currently pressed. */
  isButtonPressed(index: number): boolean {
    return this.buttonValue(index) > 0;
  }

  /** Returns a browser gamepad button value normalised to 0–1. */
  buttonValue(index: number): number {
    const value = this.gamepad.snapshot()?.buttons[index] ?? 0;
    return Math.max(0, Math.min(1, value));
  }

  /** Returns the SVG height for an analogue trigger fill bar. */
  triggerFillHeight(index: number, height: number): number {
    return this.buttonValue(index) * height;
  }

  /** Returns the SVG y-coordinate for a bottom-up trigger fill bar. */
  triggerFillY(index: number, top: number, height: number): number {
    return top + height - this.triggerFillHeight(index, height);
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
