import { Component, computed, effect, inject, untracked } from '@angular/core';

import { DriverControl } from '../../../../../core/control/drive/driver-control';
import {
  DriverControlMode,
  DriverControlModeService,
} from '../../../../../core/control/drive/drive-control-mode';
import { ControlModeCoordinator } from '../../../../../core/control/control-mode-coordinator';
import { GamepadInput } from '../../../../../core/gamepad/gamepad-input';
import { CameraFeedControl } from '../../../../../features/cameras/camera-feed-control';
import { DriveMode, FmaStateService } from '../../../../../core/fma/fma-state.service';
import { RosConnection } from '../../../../../core/ros/ros-connection';
import { RosHeartbeatMonitor } from '../../../../../core/ros/ros-heartbeat-monitor';
import { RosConnectionButton } from '../../../../../features/connection/ros-connection-button/ros-connection-button';
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
    RosConnectionButton,
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
  private readonly fmaState = inject(FmaStateService);
  private readonly gamepad = inject(GamepadInput);
  private readonly rosConnection = inject(RosConnection);
  private readonly heartbeatMonitor = inject(RosHeartbeatMonitor);
  private readonly cameraFeedControl = inject(CameraFeedControl);
  private driveModeSynchronized = false;

  private readonly modeHandshakeEffect = effect(() => {
    const client = this.rosConnection.client();
    const connected = this.heartbeatMonitor.roverAvailable();
    const hasFmaTelemetry = this.fmaState.hasFmaTelemetry();

    untracked(() => {
      if (client) this.controlModeCoordinator.prepareDriveModeRequest();

      if (!connected) {
        this.driveModeSynchronized = false;
        return;
      }

      if (!hasFmaTelemetry || this.driveModeSynchronized) return;

      this.driveModeSynchronized = true;
      this.controlModeCoordinator.synchronizeDriveModeFromRover();
    });
  });

  readonly masterDriveEnabled = this.driverControl.enabled;
  readonly driveMode = this.driverControlMode.mode;
  readonly driveModeOptions: readonly ControlModeOption[] = [
    { label: DriveMode.Manual, value: DriveMode.Manual },
    { label: DriveMode.Velocity, value: DriveMode.Velocity },
  ];
  readonly masterDriveTone: ControlSwitchTone = 'normal';
  readonly rosConnected = this.heartbeatMonitor.roverAvailable;
  readonly gamepadConnected = this.gamepad.connected;
  readonly cameraFeedEnabled = this.cameraFeedControl.enabled;
  readonly gamepadStatusLabel = computed(() =>
    this.gamepadConnected() ? 'Connected' : 'Not detected',
  );
  readonly gamepadStatusTone = computed<StatusIndicatorTone>(() =>
    this.gamepadConnected() ? 'normal' : 'neutral',
  );
  readonly gamepadFlowTone = computed<ControlFlowConnectorTone>(() =>
    this.gamepadConnected() ? 'normal' : 'neutral',
  );
  readonly rosFlowTone = computed<ControlFlowConnectorTone>(() => {
    switch (this.heartbeatMonitor.roverStatus()) {
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

  /** Starts or closes WHEP playback for every camera on this dashboard. */
  setCameraFeedEnabled(enabled: boolean): void {
    this.cameraFeedControl.setEnabled(enabled);
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
