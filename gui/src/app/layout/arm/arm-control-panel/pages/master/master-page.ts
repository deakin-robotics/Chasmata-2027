import { Component, computed, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';

import { ArmControlModeService } from '../../../../../core/control/arm/arm-control-mode';
import { ArmCommandPublisher } from '../../../../../core/control/arm/arm-command-publisher';
import { ControlModeCommandPublisher } from '../../../../../core/control/control-mode-command-publisher';
import { GamepadInput } from '../../../../../core/gamepad/gamepad-input';
import { LawRequest } from '../../../../../core/fma/fma-state.service';
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
import { TwoStepActionButton } from '../../../../../shared/two-step-action-button/two-step-action-button';

@Component({
  selector: 'app-arm-master-page',
  imports: [
    ActionButton,
    ControlFlowConnector,
    ControlSwitch,
    StatusIndicator,
    TwoStepActionButton,
  ],
  templateUrl: './master-page.html',
  styleUrl: './master-page.scss',
})
export class ArmMasterPage {
  private readonly armControlMode = inject(ArmControlModeService);
  private readonly armCommandPublisher = inject(ArmCommandPublisher);
  private readonly controlModeCommandPublisher = inject(ControlModeCommandPublisher);
  private readonly gamepad = inject(GamepadInput);
  private readonly rosConnection = inject(RosConnection);
  private readonly dialog = inject(MatDialog);

  readonly masterDriveEnabled = this.armControlMode.enabled;
  readonly masterDriveTone: ControlSwitchTone = 'normal';
  readonly readinessError = this.armControlMode.readinessError;
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

  /** Enables the input worker selected by ArmControlModeService. */
  toggleMasterDriveControl(nextState: boolean): void {
    if (!nextState) {
      this.armControlMode.disable();
      return;
    }

    const data: ControlConfirmationDialogData = {
      title: 'Enable Arm Control?',
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
        if (confirmed !== true) return;

        this.armControlMode.enable();
      });
  }

  /** Sends the explicit two-step motor-driver fault reset command. */
  clearArmFaults(button: TwoStepActionButton): void {
    if (this.armCommandPublisher.publishClearFaults()) button.reset();
  }

  activateLawOverride(): void {
    this.controlModeCommandPublisher.publishLawRequest(LawRequest.EnableOverride);
  }

  deactivateLawOverride(): void {
    this.controlModeCommandPublisher.publishLawRequest(LawRequest.Restore);
  }
}
