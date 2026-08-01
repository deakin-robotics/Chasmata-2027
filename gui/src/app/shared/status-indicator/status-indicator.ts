import { Component, input } from '@angular/core';

export type StatusIndicatorTone = 'info' | 'normal' | 'caution' | 'critical' | 'neutral';

/** A compact labelled status with a palette-aware indicator dot. */
@Component({
  selector: 'app-status-indicator',
  templateUrl: './status-indicator.html',
  styleUrl: './status-indicator.scss',
})
export class StatusIndicator {
  readonly label = input.required<string>();
  readonly status = input.required<string>();
  readonly tone = input<StatusIndicatorTone>('neutral');
}
