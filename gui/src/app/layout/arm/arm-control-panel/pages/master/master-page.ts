import { Component, computed, effect, inject, untracked } from '@angular/core';

import {
  ArmControlMode,
  ArmControlModeService,
} from '../../../../../core/control/arm/arm-control-mode';
import { ArmCommandPublisher } from '../../../../../core/control/arm/arm-command-publisher';
import { ControlModeCoordinator } from '../../../../../core/control/control-mode-coordinator';
import { ControlCommandPublisher } from '../../../../../core/control/control-command-publisher';
import { GamepadInput } from '../../../../../core/gamepad/gamepad-input';
import { CameraFeedControl } from '../../../../../features/cameras/camera-feed-control';
import { ArmMode, FmaStateService } from '../../../../../core/fma/fma-state.service';
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
import { TwoStepActionButton } from '../../../../../shared/two-step-action-button/two-step-action-button';
import {
  ControlModeOption,
  ControlModeSelector,
} from '../../../../../shared/control-mode-selector/control-mode-selector';

@Component({
  selector: 'app-arm-master-page',
  imports: [
    RosConnectionButton,
    ControlFlowConnector,
    ControlSwitch,
    StatusIndicator,
    TwoStepActionButton,
    ControlModeSelector,
  ],
  templateUrl: './master-page.html',
  styleUrl: './master-page.scss',
})
export class ArmMasterPage {
  private readonly armControlMode = inject(ArmControlModeService);
  private readonly armCommandPublisher = inject(ArmCommandPublisher);
  private readonly controlModeCoordinator = inject(ControlModeCoordinator);
  private readonly fmaState = inject(FmaStateService);
  private readonly controlCommandPublisher = inject(ControlCommandPublisher);
  private readonly gamepad = inject(GamepadInput);
  private readonly rosConnection = inject(RosConnection);
  private readonly heartbeatMonitor = inject(RosHeartbeatMonitor);
  private readonly cameraFeedControl = inject(CameraFeedControl);
  private armModeSynchronized = false;

  private readonly modeHandshakeEffect = effect(() => {
    const client = this.rosConnection.client();
    const connected = this.heartbeatMonitor.roverAvailable();
    const hasFmaTelemetry = this.fmaState.hasFmaTelemetry();

    untracked(() => {
      if (client) this.controlModeCoordinator.prepareArmModeRequest();

      if (!connected) {
        this.armModeSynchronized = false;
        return;
      }

      if (!hasFmaTelemetry || this.armModeSynchronized) return;

      this.armModeSynchronized = true;
      this.controlModeCoordinator.synchronizeArmModeFromRover();
    });
  });

  private readonly baseStationHeartbeatEffect = effect(() => {
    const available = this.heartbeatMonitor.baseStationAvailable();

    untracked(() => {
      if (!available && this.armControlMode.mode() === ArmMode.Position) {
        this.selectArmMode(ArmMode.Manual);
      }
    });
  });

  readonly masterDriveEnabled = this.armControlMode.enabled;
  readonly armMode = this.armControlMode.mode;
  readonly armModeOptions: readonly ControlModeOption[] = [
    { label: ArmMode.Manual, value: ArmMode.Manual },
    { label: ArmMode.Position, value: ArmMode.Position },
  ];
  readonly masterDriveTone: ControlSwitchTone = 'normal';
  readonly readinessError = this.armControlMode.readinessError;
  readonly rosConnected = this.heartbeatMonitor.roverAvailable;
  readonly baseStationAvailable = this.heartbeatMonitor.baseStationAvailable;
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

  /** Enables the input worker selected by ArmControlModeService. */
  toggleMasterDriveControl(nextState: boolean): void {
    if (nextState) this.armControlMode.enable();
    else this.armControlMode.disable();
  }

  /** Sends the explicit two-step motor-driver fault reset command. */
  clearArmFaults(button: TwoStepActionButton): void {
    if (this.armCommandPublisher.publishClearFaults()) button.reset();
  }

  selectArmMode(mode: string): void {
    if (mode === ArmMode.Manual || mode === ArmMode.Position) {
      this.controlModeCoordinator.selectArmMode(mode as ArmControlMode);
    }
  }

  activateLawOverride(): void {
    this.controlCommandPublisher.enableArmOverride();
  }

  deactivateLawOverride(): void {
    this.controlCommandPublisher.disableArmOverride();
  }
}
