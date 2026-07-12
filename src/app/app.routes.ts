import { Routes } from '@angular/router';
import { ArmDashboard } from './layout/arm-dashboard/arm-dashboard';
import { EcamPanel } from './layout/ecam-panel/ecam-panel';
import { MissionControl } from './layout/mission-control/mission-control';
import { PilotDashboard } from './layout/pilot-dashboard/pilot-dashboard';

export const routes: Routes = [
  {
    path: '',
    component: MissionControl,
    children: [
      {
        path: 'pilot',
        component: PilotDashboard,
      },
      {
        path: 'arm',
        component: ArmDashboard,
      },
      {
        path: 'ecam',
        component: EcamPanel,
      },
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'pilot',
      },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
