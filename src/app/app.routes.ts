import { Routes } from '@angular/router';
import { ArmDashboard } from './layout/arm/arm-dashboard/arm-dashboard';
import { EcamPanel } from './layout/ecam-panel/ecam-panel';
import { MissionControl } from './layout/mission-control/mission-control';
import { PilotDashboard } from './layout/pilot/pilot-dashboard/pilot-dashboard';
import {
  armControlGuard,
  pilotControlExitGuard,
  pilotControlGuard,
} from './core/control/control-guards';

export const routes: Routes = [
  {
    path: '',
    component: MissionControl,
    children: [
      {
        path: 'pilot',
        component: PilotDashboard,
        canActivate: [pilotControlGuard],
        canDeactivate: [pilotControlExitGuard],
      },
      {
        path: 'arm',
        component: ArmDashboard,
        canActivate: [armControlGuard],
      },
      {
        path: 'ecam',
        component: EcamPanel,
      },
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'ecam',
      },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
