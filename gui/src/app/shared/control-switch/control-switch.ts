import { Component, input, output } from '@angular/core';

export type ControlSwitchTone = 'info' | 'normal' | 'caution' | 'critical' | 'neutral';

/** A labelled two-state control for deliberate operator actions. */
@Component({
  selector: 'app-control-switch',
  templateUrl: './control-switch.html',
  styleUrl: './control-switch.scss',
})
export class ControlSwitch {
  readonly label = input.required<string>();
  readonly checked = input(false);
  readonly tone = input<ControlSwitchTone>('info');
  readonly disabled = input(false);
  readonly checkedChange = output<boolean>();

  /** Requests the opposite switch state when the control is available. */
  toggle(): void {
    if (!this.disabled()) this.checkedChange.emit(!this.checked());
  }
}
