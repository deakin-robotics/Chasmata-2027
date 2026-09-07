import { Component, signal } from '@angular/core';

import { ArmMasterPage } from './pages/master/master-page';
import { ArmModePage } from './pages/mode/mode-page';

/** Placeholder for Pilot-style Arm operator controls. */
@Component({
  selector: 'app-arm-control-panel',
  imports: [ArmMasterPage, ArmModePage],
  templateUrl: './arm-control-panel.html',
  styleUrl: './arm-control-panel.scss',
})
export class ArmControlPanel {
  readonly activeTab = signal<ArmControlPanelTab>('control');

  selectTab(tab: ArmControlPanelTab): void {
    this.activeTab.set(tab);
  }
}

type ArmControlPanelTab = 'control' | 'mode';
