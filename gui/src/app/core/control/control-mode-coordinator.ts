import { Service, effect, inject, untracked } from '@angular/core';

import { ArmControlMode, ArmControlModeService } from './arm/arm-control-mode';
import { ControlModeCommandPublisher } from './control-mode-command-publisher';
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
  private readonly commandPublisher = inject(ControlModeCommandPublisher);

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
    if (mode === this.driverControlMode.mode()) return;

    this.driverControlMode.setMode(mode);

    if (!this.rosConnection.isConnected()) return;

    this.fmaState.requestDriveMode(mode);
    this.commandPublisher.publishDriveMode(mode);
  }

  /** Selects the Arm mode and requests it from the rover when connected. */
  selectArmMode(mode: ArmControlMode): void {
    if (mode === this.armControlMode.mode()) return;

    this.armControlMode.setMode(mode);

    if (!this.rosConnection.isConnected()) return;

    this.fmaState.requestArmMode(mode);
    this.commandPublisher.publishArmMode(mode);
  }

  private requestCurrentModes(): void {
    const driveMode = this.driverControlMode.mode();
    const armMode = this.armControlMode.mode();

    this.fmaState.requestDriveMode(driveMode);
    this.fmaState.requestArmMode(armMode);
    this.commandPublisher.publishDriveMode(driveMode);
    this.commandPublisher.publishArmMode(armMode);
  }
}
