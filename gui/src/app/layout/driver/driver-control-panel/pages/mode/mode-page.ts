import { Component, inject } from '@angular/core';

import {
  DriverControlMode,
  DriverControlModeService,
} from '../../../../../core/control/drive/drive-control-mode';
import { DriveMode, FmaStateService } from '../../../../../core/fma/fma-state.service';
import {
  ControlModeOption,
  ControlModeSelector,
} from '../../../../../shared/control-mode-selector/control-mode-selector';

@Component({
  selector: 'app-driver-mode-page',
  imports: [ControlModeSelector],
  templateUrl: './mode-page.html',
  styleUrl: './mode-page.scss',
})
export class DriverModePage {
  private readonly driverControlMode = inject(DriverControlModeService);
  private readonly fmaState = inject(FmaStateService);

  readonly driveMode = this.driverControlMode.mode;
  readonly driveModeOptions: readonly ControlModeOption[] = [
    { label: DriveMode.Manual, value: DriveMode.Manual },
    { label: DriveMode.Velocity, value: DriveMode.Velocity },
  ];

  selectDriveMode(mode: string): void {
    if (mode === DriveMode.Manual || mode === DriveMode.Velocity) {
      const selectedMode = mode as DriverControlMode;
      this.driverControlMode.setMode(selectedMode);
      this.fmaState.requestDriveMode(selectedMode);
    }
  }
}
