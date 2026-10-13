import { Service, computed, signal } from '@angular/core';

import { DriveMode } from '../../fma/fma-state.service';

export type DriverControlMode = DriveMode.Manual | DriveMode.Velocity;

/** Owns the Driver's selected Manual or Velocity drive-control mode. */
@Service()
export class DriverControlModeService {
  private readonly modeState = signal<DriverControlMode>(DriveMode.Velocity);

  readonly mode = this.modeState.asReadonly();
  readonly isManual = computed(() => this.modeState() === DriveMode.Manual);
  readonly isVelocity = computed(() => this.modeState() === DriveMode.Velocity);

  /** Selects how Driver gamepad input will be interpreted. */
  setMode(mode: DriverControlMode): void {
    this.modeState.set(mode);
  }
}
