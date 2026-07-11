import { Routes } from '@angular/router';
import { MissionControl } from './layout/mission-control/mission-control';

export const routes: Routes = [
  {
    path: '',
    component: MissionControl,
  },
  {
    path: '**',
    redirectTo: '',
  },
];
