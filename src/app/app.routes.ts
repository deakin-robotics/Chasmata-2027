import { Routes } from '@angular/router';
import { ArmDashboard } from './layout/arm-dashboard/arm-dashboard';
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
