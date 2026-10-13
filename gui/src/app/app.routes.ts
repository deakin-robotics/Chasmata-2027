import { Routes } from '@angular/router';
import { MissionControl } from './layout/mission-control/mission-control';
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
        loadComponent: () =>
          import('./layout/driver/driver-dashboard/driver-dashboard').then(
            ({ DriverDashboard }) => DriverDashboard,
          ),
        canActivate: [driverControlGuard],
        canDeactivate: [driverControlExitGuard],
      },
      {
        path: 'arm',
        loadComponent: () =>
          import('./layout/arm/arm-dashboard/arm-dashboard').then(
            ({ ArmDashboard }) => ArmDashboard,
          ),
        canActivate: [armControlGuard],
        canDeactivate: [armControlExitGuard],
      },
      {
        path: 'ecam',
        loadComponent: () =>
          import('./layout/ecam-panel/ecam-panel').then(
            ({ EcamPanel }) => EcamPanel,
          ),
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
