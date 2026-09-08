import { Service, effect, inject, untracked } from '@angular/core';

import { ArmControlMode, ArmControlModeService } from './arm/arm-control-mode';
import { DriverControlMode, DriverControlModeService } from './drive/drive-control-mode';
import { FmaStateService } from '../fma/fma-state.service';
import { RosConnection } from '../ros/ros-connection';

/** Coordinates local mode selection, connection state, and FMA mode requests. */
@Service()
export class ControlModeCoordinator {
  private readonly driverControlMode = inject(DriverControlModeService);
  private readonly armControlMode = inject(ArmControlModeService);
  private readonly fmaState = inject(FmaStateService);
  private readonly rosConnection = inject(RosConnection);

  private readonly connectionEffect = effect(() => {
    const connected = this.rosConnection.isConnected();

    untracked(() => {
      if (!connected) {
        this.fmaState.resetControlModes();
        return;
      }

      this.requestCurrentModes();
    });
  });

  /** Selects the Driver mode and requests it from the rover when connected. */
  selectDriveMode(mode: DriverControlMode): void {
    this.driverControlMode.setMode(mode);

    if (!this.rosConnection.isConnected()) return;

    this.fmaState.requestDriveMode(mode);
    // Future ROS command publishing belongs at this boundary.
  }

  /** Selects the Arm mode and requests it from the rover when connected. */
  selectArmMode(mode: ArmControlMode): void {
    this.armControlMode.setMode(mode);

    if (!this.rosConnection.isConnected()) return;

    this.fmaState.requestArmMode(mode);
    // Future ROS command publishing belongs at this boundary.
  }

  private requestCurrentModes(): void {
    this.fmaState.requestDriveMode(this.driverControlMode.mode());
    this.fmaState.requestArmMode(this.armControlMode.mode());
  }
}
