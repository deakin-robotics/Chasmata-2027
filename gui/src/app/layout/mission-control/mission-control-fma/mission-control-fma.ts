import { Component, inject } from '@angular/core';

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

  readonly columns = this.fmaState.columns;
  readonly lawOverrideActive = this.fmaState.lawOverrideActive;
  readonly lawOverridePending = this.fmaState.lawOverridePending;
  readonly gimbalPriorityOwner = this.fmaState.gimbalPriorityOwner;
  readonly gimbalPriorityPending = this.fmaState.gimbalPriorityPending;
  readonly gimbalPriorityDisplay = this.fmaState.gimbalPriorityDisplay;
  readonly gimbalPriorityAriaLabel = this.fmaState.gimbalPriorityAriaLabel;
  readonly gimbalPriorityPendingDisplay = this.fmaState.gimbalPriorityPendingDisplay;
  readonly gimbalPriorityPendingAriaLabel = this.fmaState.gimbalPriorityPendingAriaLabel;
  readonly rosConnected = this.rosConnection.isConnected;
}
