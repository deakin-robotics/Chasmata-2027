import { Component, effect, inject, untracked } from '@angular/core';

import { ArmControlModeService } from '../../../core/control/arm/arm-control-mode';
import { DriverControlModeService } from '../../../core/control/drive/drive-control-mode';
import { FmaStateService } from '../../../core/fma/fma-state.service';
import { RosConnection } from '../../../core/ros/ros-connection';
import { UnavailableOverlay } from '../../../shared/unavailable-overlay/unavailable-overlay';

@Component({
  selector: 'app-mission-control-fma',
  imports: [UnavailableOverlay],
  templateUrl: './mission-control-fma.html',
  styleUrl: './mission-control-fma.scss',
})
export class MissionControlFma {
  private readonly fmaState = inject(FmaStateService);
  private readonly rosConnection = inject(RosConnection);
  private readonly driverControlMode = inject(DriverControlModeService);
  private readonly armControlMode = inject(ArmControlModeService);

  readonly columns = this.fmaState.columns;
  readonly rosConnected = this.rosConnection.isConnected;

  private readonly connectionEffect = effect(() => {
    const connected = this.rosConnection.isConnected();

    untracked(() => {
      if (!connected) {
        this.fmaState.resetControlModes();
        return;
      }

      this.fmaState.requestDriveMode(this.driverControlMode.mode());
      this.fmaState.requestArmMode(this.armControlMode.mode());
    });
  });
}
