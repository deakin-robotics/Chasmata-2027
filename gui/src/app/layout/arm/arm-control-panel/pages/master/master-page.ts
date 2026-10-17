import { Component, computed, effect, inject, signal, untracked } from '@angular/core';

import {
  ArmControlMode,
  ArmControlModeService,
} from '../../../../../core/control/arm/arm-control-mode';
import { ArmCommandPublisher } from '../../../../../core/control/arm/arm-command-publisher';
import { ControlModeCoordinator } from '../../../../../core/control/control-mode-coordinator';
import { ControlCommandPublisher } from '../../../../../core/control/control-command-publisher';
import { GamepadInput } from '../../../../../core/gamepad/gamepad-input';
import { CameraFeedControl } from '../../../../../features/cameras/camera-feed-control';
import { ArmMode } from '../../../../../core/fma/fma-state.service';
import { BaseStationConnection } from '../../../../../core/ros/base-station-connection';
import { RosConnection, type RosConnectionStatus } from '../../../../../core/ros/ros-connection';
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

type TopologyStatus = {
  readonly label: 'Off' | 'Connecting' | 'Awaiting' | 'Online' | 'Lost';
  readonly tone: StatusIndicatorTone;
};

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
  private readonly controlCommandPublisher = inject(ControlCommandPublisher);
  private readonly gamepad = inject(GamepadInput);
  private readonly rosConnection = inject(RosConnection);
  private readonly baseStationConnection = inject(BaseStationConnection);
  private readonly heartbeatMonitor = inject(RosHeartbeatMonitor);
  private readonly cameraFeedControl = inject(CameraFeedControl);
  private lastRequestedArmMode: ArmControlMode | null = null;
  private readonly roverWasAvailable = signal(false);
  private readonly baseStationWasAvailableForStatus = signal(false);

  private readonly armModeRequestEffect = effect(() => {
    const client = this.rosConnection.client();
    const roverAvailable = this.heartbeatMonitor.roverAvailable();
    const baseStationAvailable = this.heartbeatMonitor.baseStationAvailable();

    untracked(() => {
      if (client) this.controlModeCoordinator.prepareArmModeRequest();

      if (!roverAvailable) {
        this.lastRequestedArmMode = null;
        return;
      }

      const targetMode = baseStationAvailable ? ArmMode.Position : ArmMode.Manual;
      if (targetMode === this.lastRequestedArmMode) return;

      this.controlModeCoordinator.requestArmMode(targetMode);
      this.lastRequestedArmMode = targetMode;
    });
  });

  private readonly roverTopologyEffect = effect(() => {
    const status = this.rosConnection.status();
    const available = this.heartbeatMonitor.roverAvailable();

    untracked(() => {
      if (status === 'disconnected') this.roverWasAvailable.set(false);
      else if (available) this.roverWasAvailable.set(true);
    });
  });

  private readonly baseStationTopologyEffect = effect(() => {
    const status = this.baseStationConnection.status();
    const available = this.heartbeatMonitor.baseStationAvailable();

    untracked(() => {
      if (status === 'disconnected') this.baseStationWasAvailableForStatus.set(false);
      else if (available) this.baseStationWasAvailableForStatus.set(true);
    });
  });

  readonly masterDriveEnabled = this.armControlMode.enabled;
  readonly ArmMode = ArmMode;
  readonly armMode = this.armControlMode.mode;
  readonly armModeOptions: readonly ControlModeOption[] = [
    { label: ArmMode.Manual, value: ArmMode.Manual },
    { label: ArmMode.Position, value: ArmMode.Position },
  ];
  readonly masterDriveTone: ControlSwitchTone = 'normal';
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
  readonly roverTopologyStatus = computed(() =>
    this.topologyStatus(
      this.rosConnection.status(),
      this.heartbeatMonitor.roverAvailable(),
      this.roverWasAvailable(),
    ),
  );
  readonly baseStationTopologyStatus = computed(() =>
    this.topologyStatus(
      this.baseStationConnection.status(),
      this.heartbeatMonitor.baseStationAvailable(),
      this.baseStationWasAvailableForStatus(),
    ),
  );
  readonly roverFlowTone = computed<ControlFlowConnectorTone>(
    () => this.roverTopologyStatus().tone,
  );
  readonly baseStationFlowTone = computed<ControlFlowConnectorTone>(
    () => this.baseStationTopologyStatus().tone,
  );

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

  private topologyStatus(
    connectionStatus: RosConnectionStatus,
    available: boolean,
    wasAvailable: boolean,
  ): TopologyStatus {
    if (connectionStatus === 'disconnected') return { label: 'Off', tone: 'neutral' };
    if (connectionStatus === 'error') return { label: 'Lost', tone: 'critical' };
    if (available) return { label: 'Online', tone: 'normal' };
    if (wasAvailable) return { label: 'Lost', tone: 'critical' };
    if (connectionStatus === 'connecting' || connectionStatus === 'reconnecting') {
      return { label: 'Connecting', tone: 'info' };
    }

    return { label: 'Awaiting', tone: 'info' };
  }
}
