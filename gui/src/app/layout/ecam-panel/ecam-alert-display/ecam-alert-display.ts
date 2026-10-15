import { Component, inject, signal } from '@angular/core';

import { EcamAlertReporterSource } from '../../../core/ecam/ecam-alert.types';
import { EcamAlertConsumerService } from '../../../core/ecam/ecam-alert-consumer.service';
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
  readonly activeAlerts = inject(EcamAlertConsumerService).activeAlerts;
  readonly takeoffConfigResult = signal<TakeoffConfigResult | null>(null);

  reporterSourceText(sources: readonly EcamAlertReporterSource[]): string {
    return sources.map((source) => source.toUpperCase()).join(' · ');
  }

  /** Temporary visual test until T/O configuration receives real rover state. */
  runMockTakeoffConfiguration(): void {
    this.takeoffConfigResult.set('FAILED');
  }
}
