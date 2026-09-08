import { Routes } from '@angular/router';
import { ArmDashboard } from './layout/arm/arm-dashboard/arm-dashboard';
import { EcamPanel } from './layout/ecam-panel/ecam-panel';
import { MissionControl } from './layout/mission-control/mission-control';
import { DriverDashboard } from './layout/driver/driver-dashboard/driver-dashboard';
import {
  armControlExitGuard,
  armControlGuard,
  driverControlExitGuard,
  driverControlGuard,
} from './core/control/control-guards';

export const routes: Routes = [
  {
    path: '',
    component: MissionControl,
    children: [
      {
        path: 'driver',
        component: DriverDashboard,
        canActivate: [driverControlGuard],
        canDeactivate: [driverControlExitGuard],
      },
      {
        path: 'arm',
        component: ArmDashboard,
        canActivate: [armControlGuard],
        canDeactivate: [armControlExitGuard],
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
