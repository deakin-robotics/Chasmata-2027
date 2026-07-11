import { Routes } from '@angular/router';
import { ArmDashboard } from './features/arm/arm-dashboard/arm-dashboard';
import { PilotDashboard } from './features/pilot/pilot-dashboard/pilot-dashboard';
import { MissionControl } from './layout/mission-control/mission-control';

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
