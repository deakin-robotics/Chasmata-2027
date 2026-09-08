import { Service, computed, signal } from '@angular/core';

export type ControlMode = 'none' | 'driver' | 'arm';

/** Owns the currently authorised rover control mode. */
@Service()
export class ControlModeService {
  private readonly modeState = signal<ControlMode>('none');

  readonly mode = this.modeState.asReadonly();
  readonly hasActiveControl = computed(() => this.modeState() !== 'none');
  readonly isDriverActive = computed(() => this.modeState() === 'driver');
  readonly isArmActive = computed(() => this.modeState() === 'arm');

  /** Grants control authority to one operator mode. */
  activate(mode: Exclude<ControlMode, 'none'>): void {
    this.modeState.set(mode);
  }

  /** Removes all operator control authority. */
  release(): void {
    this.modeState.set('none');
  }
}
