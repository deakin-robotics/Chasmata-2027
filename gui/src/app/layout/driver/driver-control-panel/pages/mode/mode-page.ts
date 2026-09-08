import { Component, inject } from '@angular/core';

import {
  DriverControlMode,
  DriverControlModeService,
} from '../../../../../core/control/drive/drive-control-mode';
import { ControlModeCoordinator } from '../../../../../core/control/control-mode-coordinator';
import { DriveMode } from '../../../../../core/fma/fma-state.service';
import {
  ControlModeOption,
  ControlModeSelector,
} from '../../../../../shared/control-mode-selector/control-mode-selector';
import { RosConnection } from '../../../../../core/ros/ros-connection';

@Component({
  selector: 'app-driver-mode-page',
  imports: [ControlModeSelector],
  templateUrl: './mode-page.html',
  styleUrl: './mode-page.scss',
})
export class DriverModePage {
  private readonly driverControlMode = inject(DriverControlModeService);
  private readonly controlModeCoordinator = inject(ControlModeCoordinator);
  private readonly rosConnection = inject(RosConnection);

  readonly driveMode = this.driverControlMode.mode;
  readonly rosConnected = this.rosConnection.isConnected;
  readonly driveModeOptions: readonly ControlModeOption[] = [
    { label: DriveMode.Manual, value: DriveMode.Manual },
    { label: DriveMode.Velocity, value: DriveMode.Velocity },
  ];

  selectDriveMode(mode: string): void {
    if (mode === DriveMode.Manual || mode === DriveMode.Velocity) {
      this.controlModeCoordinator.selectDriveMode(mode as DriverControlMode);
    }
  }
}
