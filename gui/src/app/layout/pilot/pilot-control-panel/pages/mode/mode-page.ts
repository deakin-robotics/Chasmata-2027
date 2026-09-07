import { Component, inject } from '@angular/core';

import {
  PilotDriveControlMode,
  PilotDriveModeService,
} from '../../../../../core/control/pilot/pilot-drive-mode';
import { DriveMode, FmaStateService } from '../../../../../core/fma/fma-state.service';
import {
  ControlModeOption,
  ControlModeSelector,
} from '../../../../../shared/control-mode-selector/control-mode-selector';

@Component({
  selector: 'app-pilot-mode-page',
  imports: [ControlModeSelector],
  templateUrl: './mode-page.html',
  styleUrl: './mode-page.scss',
})
export class PilotModePage {
  private readonly pilotDriveMode = inject(PilotDriveModeService);
  private readonly fmaState = inject(FmaStateService);

  readonly driveMode = this.pilotDriveMode.mode;
  readonly driveModeOptions: readonly ControlModeOption[] = [
    { label: DriveMode.Manual, value: DriveMode.Manual },
    { label: DriveMode.Velocity, value: DriveMode.Velocity },
  ];

  selectDriveMode(mode: string): void {
    if (mode === DriveMode.Manual || mode === DriveMode.Velocity) {
      const selectedMode = mode as PilotDriveControlMode;
      this.pilotDriveMode.setMode(selectedMode);
      this.fmaState.requestDriveMode(selectedMode);
    }
  }
}
