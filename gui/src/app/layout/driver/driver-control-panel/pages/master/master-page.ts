import { Component, computed, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';

import { DriverControl } from '../../../../../core/control/drive/driver-control';
import {
  DriverControlMode,
  DriverControlModeService,
} from '../../../../../core/control/drive/drive-control-mode';
import { ControlModeCoordinator } from '../../../../../core/control/control-mode-coordinator';
import { GamepadInput } from '../../../../../core/gamepad/gamepad-input';
import { DriveMode } from '../../../../../core/fma/fma-state.service';
import { RosConnection } from '../../../../../core/ros/ros-connection';
import { ConnectionManager } from '../../../../../features/connection/connection-manager/connection-manager';
import { ActionButton, ActionButtonTone } from '../../../../../shared/action-button/action-button';
import {
  ControlFlowConnector,
  ControlFlowConnectorTone,
} from '../../../../../shared/control-flow-connector/control-flow-connector';
import {
  ControlSwitch,
  ControlSwitchTone,
} from '../../../../../shared/control-switch/control-switch';
import {
  StatusIndicator,
  StatusIndicatorTone,
} from '../../../../../shared/status-indicator/status-indicator';
import {
  ControlModeOption,
  ControlModeSelector,
} from '../../../../../shared/control-mode-selector/control-mode-selector';

@Component({
  selector: 'app-driver-master-page',
  imports: [
    ActionButton,
    ControlFlowConnector,
    ControlModeSelector,
    ControlSwitch,
    StatusIndicator,
  ],
  templateUrl: './master-page.html',
  styleUrl: './master-page.scss',
})
export class DriverMasterPage {
  private readonly driverControl = inject(DriverControl);
  private readonly driverControlMode = inject(DriverControlModeService);
  private readonly controlModeCoordinator = inject(ControlModeCoordinator);
  private readonly gamepad = inject(GamepadInput);
  private readonly rosConnection = inject(RosConnection);
  private readonly dialog = inject(MatDialog);

  readonly masterDriveEnabled = this.driverControl.enabled;
  readonly driveMode = this.driverControlMode.mode;
  readonly driveModeOptions: readonly ControlModeOption[] = [
    { label: DriveMode.Manual, value: DriveMode.Manual },
    { label: DriveMode.Velocity, value: DriveMode.Velocity },
  ];
  readonly masterDriveTone: ControlSwitchTone = 'normal';
  readonly readinessError = this.driverControl.readinessError;
  readonly rosConnected = this.rosConnection.isConnected;
  readonly gamepadConnected = this.gamepad.connected;
  readonly gamepadStatusLabel = computed(() =>
    this.gamepadConnected() ? 'Connected' : 'Not detected',
  );
  readonly gamepadStatusTone = computed<StatusIndicatorTone>(() =>
    this.gamepadConnected() ? 'normal' : 'neutral',
  );
  readonly gamepadFlowTone = computed<ControlFlowConnectorTone>(() =>
    this.gamepadConnected() ? 'normal' : 'neutral',
  );
  readonly rosActionLabel = computed(() => {
    switch (this.rosConnection.status()) {
      case 'connecting':
        return 'Connecting';
      case 'connected':
        return 'Connected';
      case 'reconnecting':
        return 'Reconnecting';
      case 'error':
        return 'Retry';
      default:
        return 'Connect';
    }
  });
  readonly rosActionTone = computed<ActionButtonTone>(() => {
    switch (this.rosConnection.status()) {
      case 'connected':
        return 'normal';
      case 'error':
        return 'caution';
      case 'connecting':
      case 'reconnecting':
      case 'disconnected':
        return 'info';
    }
  });
  readonly rosActionBusy = computed(() => this.rosConnection.isConnecting());
  readonly rosFlowTone = computed<ControlFlowConnectorTone>(() => {
    switch (this.rosConnection.status()) {
      case 'connected':
        return 'normal';
      case 'error':
        return 'caution';
      default:
        return 'info';
    }
  });

  constructor() {
    this.gamepad.start();
  }

  /** Opens ROSbridge endpoint configuration and connection controls. */
  openRosConnectionSettings(): void {
    this.dialog.open(ConnectionManager, {
      ariaLabel: 'ROS connection settings',
      width: 'min(100% - 2rem, 32rem)',
    });
  }

  /** Requests enabled drivetrain publishing or immediately stops active publishing. */
  toggleMasterDriveControl(nextState: boolean): void {
    if (nextState) this.driverControl.enable();
    else this.driverControl.disable();
  }

  selectDriveMode(mode: string): void {
    if (mode === DriveMode.Manual || mode === DriveMode.Velocity) {
      this.controlModeCoordinator.selectDriveMode(mode as DriverControlMode);
    }
  }
}
