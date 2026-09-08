import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';

export type TwoStepActionStatus = 'idle' | 'active';
export type TwoStepActionState = 'locked' | 'armed' | 'active';

/** A reusable two-click action: arm first, then emit a command for confirmation. */
@Component({
  selector: 'app-two-step-action-button',
  templateUrl: './two-step-action-button.html',
  styleUrl: './two-step-action-button.scss',
  host: {
    '[class.armed]': 'isArmed()',
    '[class.active]': 'isActive()',
  },
})
export class TwoStepActionButton {
  private readonly destroyRef = inject(DestroyRef);
  private armTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly armedState = signal(false);

  readonly label = input.required<string>();
  readonly actionLabel = input.required<string>();
  readonly armedDurationMs = input(3_000);
  readonly disabled = input(false);
  readonly status = model<TwoStepActionStatus>('idle');
  readonly activated = output<void>();
  readonly deactivated = output<void>();

  readonly state = computed<TwoStepActionState>(() => {
    switch (this.status()) {
      case 'active':
        return 'active';
      default:
        return this.armedState() ? 'armed' : 'locked';
    }
  });
  readonly isArmed = computed(() => this.state() === 'armed');
  readonly isActive = computed(() => this.state() === 'active');

  constructor() {
    this.destroyRef.onDestroy(() => this.clearArmTimer());
  }

  handleClick(): void {
    if (this.disabled()) return;

    if (this.status() === 'active') {
      this.reset();
      this.deactivated.emit();
      return;
    }

    if (this.isArmed()) {
      this.clearArmTimer();
      this.armedState.set(false);
      this.status.set('active');
      this.activated.emit();
      return;
    }

    this.armedState.set(true);
    this.armTimer = setTimeout(() => {
      this.armTimer = null;
      this.armedState.set(false);
    }, this.armedDurationMs());
  }

  reset(): void {
    this.clearArmTimer();
    this.armedState.set(false);
    this.status.set('idle');
  }

  private clearArmTimer(): void {
    if (this.armTimer === null) return;

    clearTimeout(this.armTimer);
    this.armTimer = null;
  }
}
