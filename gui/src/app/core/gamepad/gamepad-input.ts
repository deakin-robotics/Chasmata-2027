import { Service, signal } from '@angular/core';

export interface GamepadSnapshot {
  axes: readonly number[];
  buttons: readonly number[];
}

const DEADZONE = 0.1;

/** Reads the browser Gamepad API without publishing rover commands. */
@Service()
export class GamepadInput {
  private animationFrameId: number | null = null;
  private monitoring = false;

  private readonly connectedState = signal(false);
  private readonly nameState = signal<string | null>(null);
  private readonly snapshotState = signal<GamepadSnapshot | null>(null);

  readonly connected = this.connectedState.asReadonly();
  readonly name = this.nameState.asReadonly();
  readonly snapshot = this.snapshotState.asReadonly();

  /** Begins observing the first available browser gamepad. */
  start(): void {
    if (this.monitoring || !this.supportsGamepads()) return;

    this.monitoring = true;
    window.addEventListener('gamepadconnected', this.refreshGamepad);
    window.addEventListener('gamepaddisconnected', this.refreshGamepad);
    window.addEventListener('blur', this.clearSnapshot);
    this.poll();
  }

  /** Stops observing the gamepad and clears the current input snapshot. */
  stop(): void {
    if (!this.monitoring) return;

    this.monitoring = false;
    window.removeEventListener('gamepadconnected', this.refreshGamepad);
    window.removeEventListener('gamepaddisconnected', this.refreshGamepad);
    window.removeEventListener('blur', this.clearSnapshot);

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.connectedState.set(false);
    this.nameState.set(null);
    this.snapshotState.set(null);
  }

  private readonly poll = (): void => {
    if (!this.monitoring) return;

    this.refreshGamepad();
    this.animationFrameId = requestAnimationFrame(this.poll);
  };

  private readonly refreshGamepad = (): void => {
    if (!this.supportsGamepads()) return;

    const gamepad = Array.from(navigator.getGamepads()).find(
      (candidate): candidate is Gamepad => candidate !== null,
    );

    if (!gamepad) {
      this.connectedState.set(false);
      this.nameState.set(null);
      this.snapshotState.set(null);
      return;
    }

    this.connectedState.set(true);
    this.nameState.set(gamepad.id);
    this.snapshotState.set({
      axes: gamepad.axes.map((axis) => this.applyDeadzone(axis)),
      buttons: gamepad.buttons.map((button) => (button.pressed ? 1 : 0)),
    });
  };

  private readonly clearSnapshot = (): void => {
    this.snapshotState.set(null);
  };

  private supportsGamepads(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
  }

  private applyDeadzone(value: number): number {
    if (Math.abs(value) < DEADZONE) return 0;

    return (value - Math.sign(value) * DEADZONE) / (1 - DEADZONE);
  }
}
