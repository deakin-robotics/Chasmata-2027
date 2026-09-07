import { Component, signal } from '@angular/core';

import {
  ControlPanelShell,
  ControlPanelTab,
} from '../../../shared/control-panel-shell/control-panel-shell';
import { PilotMasterPage } from './pages/master/master-page';

/** Groups the Pilot workspace's operational controls. */
@Component({
  selector: 'app-pilot-control-panel',
  imports: [ControlPanelShell, PilotMasterPage],
  templateUrl: './pilot-control-panel.html',
  styleUrl: './pilot-control-panel.scss',
})
export class PilotControlPanel {
  readonly activeTab = signal('master');
  readonly tabs: readonly ControlPanelTab[] = [{ id: 'master', label: 'Master' }];
}
