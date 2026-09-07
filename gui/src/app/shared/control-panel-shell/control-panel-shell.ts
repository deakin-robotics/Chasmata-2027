import { Component, computed, input, model } from '@angular/core';

export interface ControlPanelTab {
  readonly id: string;
  readonly label: string;
}

/** Shared frame for control panels with a tab header and fixed content slot. */
@Component({
  selector: 'app-control-panel-shell',
  templateUrl: './control-panel-shell.html',
  styleUrl: './control-panel-shell.scss',
})
export class ControlPanelShell {
  readonly label = input.required<string>();
  readonly tabs = input.required<readonly ControlPanelTab[]>();
  readonly activeTab = model<string>('');

  readonly activeIndex = computed(() => {
    const index = this.tabs().findIndex((tab) => tab.id === this.activeTab());
    return index >= 0 ? index : 0;
  });

  selectTab(tabId: string): void {
    if (this.tabs().some((tab) => tab.id === tabId)) {
      this.activeTab.set(tabId);
    }
  }
}
