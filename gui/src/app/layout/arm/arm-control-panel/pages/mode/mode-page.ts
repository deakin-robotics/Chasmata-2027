import { Component, inject } from '@angular/core';

import {
  ArmControlMode,
  ArmControlModeService,
} from '../../../../../core/control/arm/arm-control-mode';
import { ArmMode, FmaStateService } from '../../../../../core/fma/fma-state.service';
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
  private readonly fmaState = inject(FmaStateService);
  private readonly rosConnection = inject(RosConnection);

  readonly armMode = this.armControlMode.mode;
  readonly rosConnected = this.rosConnection.isConnected;
  readonly armModeOptions: readonly ControlModeOption[] = [
    { label: ArmMode.Manual, value: ArmMode.Manual },
    { label: ArmMode.Position, value: ArmMode.Position },
  ];

  selectArmMode(mode: string): void {
    if (mode === ArmMode.Manual || mode === ArmMode.Position) {
      const selectedMode = mode as ArmControlMode;
      this.armControlMode.setMode(selectedMode);
      if (this.rosConnection.isConnected()) {
        this.fmaState.requestArmMode(selectedMode);
      }
    }
  }
}
