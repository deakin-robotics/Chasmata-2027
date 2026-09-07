import { Component, computed, input, output } from '@angular/core';

export interface ControlModeOption {
  readonly label: string;
  readonly value: string;
}

/** A reusable selector that always keeps one control mode active. */
@Component({
  selector: 'app-control-mode-selector',
  templateUrl: './control-mode-selector.html',
  styleUrl: './control-mode-selector.scss',
})
export class ControlModeSelector {
  readonly label = input.required<string>();
  readonly options = input.required<readonly ControlModeOption[]>();
  readonly value = input.required<string>();
  readonly valueChange = output<string>();
  readonly activeIndex = computed(() => {
    const index = this.options().findIndex((option) => option.value === this.value());
    return index >= 0 ? index : 0;
  });

  select(value: string): void {
    if (this.options().some((option) => option.value === value)) {
      this.valueChange.emit(value);
    }
  }
}
