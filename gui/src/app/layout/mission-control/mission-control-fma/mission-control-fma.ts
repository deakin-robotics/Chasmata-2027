import { Component, inject } from '@angular/core';

import { FmaStateService } from '../../../core/fma/fma-state.service';
import { UnavailableOverlay } from '../../../shared/unavailable-overlay/unavailable-overlay';

@Component({
  selector: 'app-mission-control-fma',
  imports: [UnavailableOverlay],
  templateUrl: './mission-control-fma.html',
  styleUrl: './mission-control-fma.scss',
})
export class MissionControlFma {
  private readonly fmaState = inject(FmaStateService);

  readonly columns = this.fmaState.columns;
  readonly armOverrideActive = this.fmaState.armOverrideActive;
  readonly armOverridePending = this.fmaState.armOverridePending;
  readonly gimbalPriorityOwner = this.fmaState.gimbalPriorityOwner;
  readonly gimbalPriorityPending = this.fmaState.gimbalPriorityPending;
  readonly gimbalPriorityDisplay = this.fmaState.gimbalPriorityDisplay;
  readonly gimbalPriorityAriaLabel = this.fmaState.gimbalPriorityAriaLabel;
  readonly gimbalPriorityPendingDisplay = this.fmaState.gimbalPriorityPendingDisplay;
  readonly gimbalPriorityPendingAriaLabel = this.fmaState.gimbalPriorityPendingAriaLabel;
  readonly fmaAvailable = this.fmaState.hasFmaTelemetry;
}
