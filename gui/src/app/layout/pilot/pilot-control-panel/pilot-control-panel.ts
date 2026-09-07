import { Component, signal } from '@angular/core';

import {
  ControlPanelShell,
  ControlPanelTab,
} from '../../../shared/control-panel-shell/control-panel-shell';
import { PilotMasterPage } from './pages/master/master-page';
import { PilotModePage } from './pages/mode/mode-page';

/** Groups the Pilot workspace's operational controls. */
@Component({
  selector: 'app-pilot-control-panel',
  imports: [ControlPanelShell, PilotMasterPage, PilotModePage],
  templateUrl: './pilot-control-panel.html',
  styleUrl: './pilot-control-panel.scss',
})
export class PilotControlPanel {
  readonly activeTab = signal<PilotControlPanelTab>('master');
  readonly tabs: readonly ControlPanelTab[] = [
    { id: 'master', label: 'Master' },
    { id: 'mode', label: 'Mode' },
  ];

  selectTab(tab: PilotControlPanelTab): void {
    this.activeTab.set(tab);
  }
}

type PilotControlPanelTab = 'master' | 'mode';
