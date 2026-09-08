import { Component, inject } from '@angular/core';

import { GimbalPriorityService } from '../../../core/fma/gimbal-priority.service';
import { FmaStateService } from '../../../core/fma/fma-state.service';
import { RosConnection } from '../../../core/ros/ros-connection';
import { UnavailableOverlay } from '../../../shared/unavailable-overlay/unavailable-overlay';

@Component({
  selector: 'app-mission-control-fma',
  imports: [UnavailableOverlay],
  templateUrl: './mission-control-fma.html',
  styleUrl: './mission-control-fma.scss',
})
export class MissionControlFma {
  private readonly fmaState = inject(FmaStateService);
  private readonly rosConnection = inject(RosConnection);
  readonly gimbalPriority = inject(GimbalPriorityService);

  readonly columns = this.fmaState.columns;
  readonly rosConnected = this.rosConnection.isConnected;
}
