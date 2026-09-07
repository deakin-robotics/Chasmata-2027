import { Service, computed, signal } from '@angular/core';

import { ArmMode } from '../../fma/fma-state.service';

export type ArmControlMode = ArmMode.Manual | ArmMode.Position;

/** Owns the Arm Operator's selected Manual or Position control mode. */
@Service()
export class ArmControlModeService {
  private readonly modeState = signal<ArmControlMode>(ArmMode.Position);

  readonly mode = this.modeState.asReadonly();
  readonly isManual = computed(() => this.modeState() === ArmMode.Manual);
  readonly isPosition = computed(() => this.modeState() === ArmMode.Position);

  /** Selects how Arm Operator input will be interpreted. */
  setMode(mode: ArmControlMode): void {
    this.modeState.set(mode);
  }
}
