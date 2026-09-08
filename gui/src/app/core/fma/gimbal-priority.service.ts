import { Service, computed, signal } from '@angular/core';

export type GimbalPriorityOwner = 'DRIVER' | 'ARM OPS';

/** Holds the GUI's temporary view of the authoritative gimbal owner. */
@Service()
export class GimbalPriorityService {
  private readonly ownerState = signal<GimbalPriorityOwner | null>(null);

  readonly owner = this.ownerState.asReadonly();
  readonly display = computed(() => {
    switch (this.ownerState()) {
      case 'DRIVER':
        return '← DRIVER';
      case 'ARM OPS':
        return 'ARM OPS →';
      default:
        return 'GIM PRI UNK';
    }
  });
  readonly ariaLabel = computed(() => {
    switch (this.ownerState()) {
      case 'DRIVER':
        return 'Gimbal priority: Driver';
      case 'ARM OPS':
        return 'Gimbal priority: Arm Operator';
      default:
        return 'Gimbal priority unknown';
    }
  });

  /** Temporary local setter for tests and the future telemetry adapter. */
  setOwner(owner: GimbalPriorityOwner | null): void {
    this.ownerState.set(owner);
  }
}
