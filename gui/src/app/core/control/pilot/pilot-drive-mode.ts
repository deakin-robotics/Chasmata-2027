import { Service, computed, signal } from '@angular/core';

import { DriveMode } from '../../fma/fma-state.service';

export type PilotDriveControlMode = DriveMode.Manual | DriveMode.Velocity;

/** Owns the Pilot's selected Manual or Velocity drive-control mode. */
@Service()
export class PilotDriveModeService {
  private readonly modeState = signal<PilotDriveControlMode>(DriveMode.Manual);

  readonly mode = this.modeState.asReadonly();
  readonly isManual = computed(() => this.modeState() === DriveMode.Manual);
  readonly isVelocity = computed(() => this.modeState() === DriveMode.Velocity);

  /** Selects how Pilot gamepad input will be interpreted. */
  setMode(mode: PilotDriveControlMode): void {
    this.modeState.set(mode);
  }
}
