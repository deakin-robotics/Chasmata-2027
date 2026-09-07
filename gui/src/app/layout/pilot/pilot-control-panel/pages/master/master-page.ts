import { Component, computed, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';

import { GamepadInput } from '../../../../../core/gamepad/gamepad-input';
import { PilotDriveControl } from '../../../../../core/control/pilot/pilot-drive-control';
import { RosConnection } from '../../../../../core/ros/ros-connection';
import { ConnectionManager } from '../../../../../features/connection/connection-manager/connection-manager';
import { ActionButton, ActionButtonTone } from '../../../../../shared/action-button/action-button';
import {
  ControlConfirmationDialog,
  ControlConfirmationDialogData,
} from '../../../../../shared/confirmation-dialog/control-confirmation-dialog';
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

@Component({
  selector: 'app-pilot-master-page',
  imports: [ActionButton, ControlFlowConnector, ControlSwitch, StatusIndicator],
  templateUrl: './master-page.html',
  styleUrl: './master-page.scss',
})
export class PilotMasterPage {
  private readonly pilotDriveControl = inject(PilotDriveControl);
  private readonly gamepad = inject(GamepadInput);
  private readonly rosConnection = inject(RosConnection);
  private readonly dialog = inject(MatDialog);

  readonly masterDriveEnabled = this.pilotDriveControl.enabled;
  readonly masterDriveTone: ControlSwitchTone = 'normal';
  readonly readinessError = this.pilotDriveControl.readinessError;
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
    if (!nextState) {
      this.pilotDriveControl.disable();
      return;
    }

    const data: ControlConfirmationDialogData = {
      title: 'Enable Master Drive Control?',
      confirmLabel: 'Enable control',
    };

    this.dialog
      .open(ControlConfirmationDialog, {
        data,
        disableClose: true,
        width: 'min(100% - 2rem, 28rem)',
      })
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed === true) this.pilotDriveControl.enable();
      });
  }
}
