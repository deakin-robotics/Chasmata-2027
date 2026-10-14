import { Component, inject, signal } from '@angular/core';

import { EcamAlertService } from '../../../core/ecam/ecam-alert.service';
import { RosConnectionButton } from '../../../features/connection/ros-connection-button/ros-connection-button';

type TakeoffConfigResult = 'NORMAL' | 'FAILED' | 'UNKNOWN';

/** Upper ECAM display for prioritised rover alerts and error history. */
@Component({
  selector: 'app-ecam-alert-display',
  imports: [RosConnectionButton],
  templateUrl: './ecam-alert-display.html',
  styleUrl: './ecam-alert-display.scss',
})
export class EcamAlertDisplay {
  readonly activeAlerts = inject(EcamAlertService).activeAlerts;
  readonly takeoffConfigResult = signal<TakeoffConfigResult | null>(null);

  /** Temporary visual test until T/O configuration receives real rover state. */
  runMockTakeoffConfiguration(): void {
    this.takeoffConfigResult.set('FAILED');
  }
}
