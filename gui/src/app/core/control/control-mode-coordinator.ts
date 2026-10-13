import { Service, effect, inject, untracked } from '@angular/core';

import { ArmControlMode, ArmControlModeService } from './arm/arm-control-mode';
import { ControlCommandPublisher } from './control-command-publisher';
import { DriverControlMode, DriverControlModeService } from './drive/drive-control-mode';
import { ArmMode, DriveMode, FmaColumn, FmaStateService } from '../fma/fma-state.service';
import { RosHeartbeatMonitor } from '../ros/ros-heartbeat-monitor';

/** Coordinates local mode selection, connection state, and FMA mode requests. */
@Service()
export class ControlModeCoordinator {
  private readonly driverControlMode = inject(DriverControlModeService);
  private readonly armControlMode = inject(ArmControlModeService);
  private readonly fmaState = inject(FmaStateService);
  private readonly heartbeatMonitor = inject(RosHeartbeatMonitor);
  private readonly commandPublisher = inject(ControlCommandPublisher);

  private readonly connectionEffect = effect(() => {
    const connected = this.heartbeatMonitor.roverAvailable();

    untracked(() => {
      if (!connected) {
        this.fmaState.resetControlModes();
        return;
      }

    });
  });

  /** Prepares the Driver request topic before this dashboard receives rover readiness. */
  prepareDriveModeRequest(): void {
    this.commandPublisher.prepareDriveModeRequest();
  }

  /** Prepares the Arm request topic before this dashboard receives rover readiness. */
  prepareArmModeRequest(): void {
    this.commandPublisher.prepareArmModeRequest();
  }

  /** Syncs the Driver selector from the first rover FMA state, or initializes it. */
  synchronizeDriveModeFromRover(): void {
    if (!this.heartbeatMonitor.roverAvailable()) return;

    const roverMode = this.currentDriveModeFromRover();
    if (roverMode) {
      if (roverMode === DriveMode.Manual || roverMode === DriveMode.Velocity) {
        this.driverControlMode.setMode(roverMode);
      }
      return;
    }

    const mode = this.driverControlMode.mode();
    this.fmaState.requestDriveMode(mode);
    this.commandPublisher.publishDriveMode(mode);
  }

  /** Syncs the Arm selector from the first rover FMA state, or initializes it. */
  synchronizeArmModeFromRover(): void {
    if (!this.heartbeatMonitor.roverAvailable()) return;

    const roverMode = this.currentArmModeFromRover();
    if (roverMode) {
      if (roverMode === ArmMode.Manual || roverMode === ArmMode.Position) {
        this.armControlMode.setMode(roverMode);
      }
      return;
    }

    const mode = this.armControlMode.mode();
    this.fmaState.requestArmMode(mode);
    this.commandPublisher.publishArmMode(mode);
  }

  /** Selects the Driver mode and requests it from the rover when connected. */
  selectDriveMode(mode: DriverControlMode): void {
    if (mode === this.driverControlMode.mode()) return;

    this.driverControlMode.setMode(mode);

    if (!this.heartbeatMonitor.roverAvailable()) return;

    this.fmaState.requestDriveMode(mode);
    this.commandPublisher.publishDriveMode(mode);
  }

  /** Selects the Arm mode and requests it from the rover when connected. */
  selectArmMode(mode: ArmControlMode): void {
    if (mode === this.armControlMode.mode()) return;

    this.armControlMode.setMode(mode);

    if (!this.heartbeatMonitor.roverAvailable()) return;

    this.fmaState.requestArmMode(mode);
    this.commandPublisher.publishArmMode(mode);
  }

  private currentDriveModeFromRover(): DriveMode | null {
    const column = this.fmaState.columns().find(
      (candidate): candidate is Extract<FmaColumn, { label: 'DRIVE' }> =>
        candidate.label === 'DRIVE',
    );
    return column ? (column.confirmed ?? column.commanded) : null;
  }

  private currentArmModeFromRover(): ArmMode | null {
    const column = this.fmaState.columns().find(
      (candidate): candidate is Extract<FmaColumn, { label: 'ARM' }> =>
        candidate.label === 'ARM',
    );
    return column ? (column.confirmed ?? column.commanded) : null;
  }
}
