import { Component, signal } from '@angular/core';

import {
  ControlPanelShell,
  ControlPanelTab,
} from '../../../shared/control-panel-shell/control-panel-shell';
import { ArmMasterPage } from './pages/master/master-page';

/** Supplies Arm pages to the shared control-panel shell. */
@Component({
  selector: 'app-arm-control-panel',
  imports: [ArmMasterPage, ControlPanelShell],
  templateUrl: './arm-control-panel.html',
  styleUrl: './arm-control-panel.scss',
})
export class ArmControlPanel {
  readonly activeTab = signal<ArmControlPanelTab>('master');
  readonly tabs: readonly ControlPanelTab[] = [
    { id: 'master', label: 'Master' },
  ];

  selectTab(tab: ArmControlPanelTab): void {
    this.activeTab.set(tab);
  }
}

type ArmControlPanelTab = 'master';
