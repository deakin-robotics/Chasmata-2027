import { Component, signal } from '@angular/core';

import {
  ControlPanelShell,
  ControlPanelTab,
} from '../../../shared/control-panel-shell/control-panel-shell';
import { DriverMasterPage } from './pages/master/master-page';

/** Groups the Driver workspace's operational controls. */
@Component({
  selector: 'app-driver-control-panel',
  imports: [ControlPanelShell, DriverMasterPage],
  templateUrl: './driver-control-panel.html',
  styleUrl: './driver-control-panel.scss',
})
export class DriverControlPanel {
  readonly activeTab = signal<DriverControlPanelTab>('master');
  readonly tabs: readonly ControlPanelTab[] = [{ id: 'master', label: 'Master' }];

  selectTab(tab: DriverControlPanelTab): void {
    this.activeTab.set(tab);
  }
}

type DriverControlPanelTab = 'master';
