import { Component, inject } from '@angular/core';

import { FmaStateService } from '../../../core/fma/fma-state.service';

@Component({
  selector: 'app-mission-control-fma',
  templateUrl: './mission-control-fma.html',
  styleUrl: './mission-control-fma.scss',
})
export class MissionControlFma {
  private readonly fmaState = inject(FmaStateService);

  readonly columns = this.fmaState.columns;
}
