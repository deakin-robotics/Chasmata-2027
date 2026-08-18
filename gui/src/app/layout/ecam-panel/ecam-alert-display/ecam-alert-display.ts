import { Component, inject, signal } from '@angular/core';

import { EcamAlertService } from '../../../core/ecam/ecam-alert.service';

type TakeoffConfigResult = 'NORMAL' | 'FAILED' | 'UNKNOWN';

/** Upper ECAM display for prioritised rover alerts and error history. */
@Component({
  selector: 'app-ecam-alert-display',
  templateUrl: './ecam-alert-display.html',
  styleUrl: './ecam-alert-display.scss',
})
export class EcamAlertDisplay {
  private readonly ecamAlerts = inject(EcamAlertService);

  readonly activeAlerts = this.ecamAlerts.activeAlerts;
  readonly takeoffConfigResult = signal<TakeoffConfigResult | null>(null);

  /** Temporary visual test until T/O configuration receives real rover state. */
  runMockTakeoffConfiguration(): void {
    this.takeoffConfigResult.set('FAILED');
    this.ecamAlerts.clearAll();
    this.ecamAlerts.raise('CONFIG_ESTOP_STATUS_UNAVAILABLE');
    this.ecamAlerts.raise('CONFIG_LAW_DIRECT');
    this.ecamAlerts.raise('CONFIG_ANTENNA_NOT_DEPLOYED');
  }
}
