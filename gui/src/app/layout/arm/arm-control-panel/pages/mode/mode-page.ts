import { Component, inject } from '@angular/core';

import { ArmIkCoordinator } from '../../../../../core/arm/ik/arm-ik-coordinator';
import {
  ArmControlMode,
  ArmControlModeService,
} from '../../../../../core/control/arm/arm-control-mode';
import { ControlModeCoordinator } from '../../../../../core/control/control-mode-coordinator';
import { ArmMode } from '../../../../../core/fma/fma-state.service';
import { ArmOrientationMode } from '../../../../../core/arm/ik/arm-ik-types';
import {
  ControlModeOption,
  ControlModeSelector,
} from '../../../../../shared/control-mode-selector/control-mode-selector';
import { RosConnection } from '../../../../../core/ros/ros-connection';

@Component({
  selector: 'app-arm-mode-page',
  imports: [ControlModeSelector],
  templateUrl: './mode-page.html',
  styleUrl: './mode-page.scss',
})
export class ArmModePage {
  private readonly armControlMode = inject(ArmControlModeService);
  private readonly armIkCoordinator = inject(ArmIkCoordinator);
  private readonly controlModeCoordinator = inject(ControlModeCoordinator);
  private readonly rosConnection = inject(RosConnection);

  readonly armMode = this.armControlMode.mode;
  readonly orientationMode = this.armIkCoordinator.orientationMode;
  readonly rosConnected = this.rosConnection.isConnected;
  readonly canChangeOrientationMode = this.armIkCoordinator.canChangeOrientationMode;
  readonly orientationModeOptions: readonly ControlModeOption[] = [
    { label: 'UNLOCKED', value: 'unlocked' },
    { label: 'LOCKED', value: 'locked' },
  ];
  readonly armModeOptions: readonly ControlModeOption[] = [
    { label: ArmMode.Manual, value: ArmMode.Manual },
    { label: ArmMode.Position, value: ArmMode.Position },
  ];

  selectArmMode(mode: string): void {
    if (mode === ArmMode.Manual || mode === ArmMode.Position) {
      this.controlModeCoordinator.selectArmMode(mode as ArmControlMode);
    }
  }

  selectOrientationMode(mode: string): void {
    if (mode === 'locked' || mode === 'unlocked') {
      this.armIkCoordinator.setOrientationMode(mode as ArmOrientationMode);
    }
  }
}
