import { Component, input, output } from '@angular/core';

export type ActionButtonTone = 'info' | 'normal' | 'caution' | 'critical' | 'neutral';

/** A reusable palette-aware button for operator-requested actions. */
@Component({
  selector: 'app-action-button',
  templateUrl: './action-button.html',
  styleUrl: './action-button.scss',
})
export class ActionButton {
  readonly label = input.required<string>();
  readonly actionLabel = input.required<string>();
  readonly tone = input<ActionButtonTone>('neutral');
  readonly disabled = input(false);
  readonly busy = input(false);
  readonly pressed = output<void>();

  /** Emits an action request when the button is available. */
  requestAction(): void {
    if (!this.disabled()) this.pressed.emit();
  }
}
