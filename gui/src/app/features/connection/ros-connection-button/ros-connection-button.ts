import { Component, computed, inject } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { ArmControlModeService } from '../../../core/control/arm/arm-control-mode';
import { ArmMode } from '../../../core/fma/fma-state.service';
import { BaseStationConnection } from '../../../core/ros/base-station-connection';
import { RosConnection } from '../../../core/ros/ros-connection';
import { RosHeartbeatMonitor } from '../../../core/ros/ros-heartbeat-monitor';
import { ControlSwitch, ControlSwitchTone } from '../../../shared/control-switch/control-switch';

/** Connects or disconnects the fixed Rover and BaseStation ROS links together. */
@Component({ selector: 'app-ros-connection-button', imports: [ControlSwitch], templateUrl: './ros-connection-button.html', styleUrl: './ros-connection-button.scss' })
export class RosConnectionButton {
  private readonly roverConnection = inject(RosConnection);
  private readonly baseStationConnection = inject(BaseStationConnection);
  private readonly heartbeatMonitor = inject(RosHeartbeatMonitor);
  private readonly armControlMode = inject(ArmControlModeService);
  readonly label = 'ROS Link';
  readonly checked = computed(() => {
    const roverStatus = this.roverConnection.status();
    const baseStationStatus = this.baseStationConnection.status();

    return roverStatus !== 'disconnected' || baseStationStatus !== 'disconnected';
  });
  readonly tone = computed<ControlSwitchTone>(() => {
    if (!this.checked()) return 'info';

    const roverStatus = this.roverConnection.status();
    const baseStationStatus = this.baseStationConnection.status();
    const roverOnline = this.heartbeatMonitor.roverAvailable();
    const baseStationOnline = this.heartbeatMonitor.baseStationAvailable();
    const roverFailed = this.linkFailed(
      roverStatus,
      roverOnline,
      this.heartbeatMonitor.roverWasAvailable(),
    );
    const baseStationFailed = this.linkFailed(
      baseStationStatus,
      baseStationOnline,
      this.heartbeatMonitor.baseStationWasAvailable(),
    );

    if (roverOnline && baseStationOnline) return 'normal';
    if (roverFailed && baseStationFailed) return 'critical';
    if (roverFailed || baseStationFailed) return 'caution';
    return 'info';
  });
  readonly flashing = computed(() => this.checked() && this.tone() === 'info');

  setConnected(connected: boolean): void {
    if (connected) {
      this.roverConnection.connect(environment.rosbridgeUrl);
      this.baseStationConnection.connect(environment.basestationRosbridgeUrl);
      return;
    }

    this.heartbeatMonitor.resetLinkHistory();
    this.armControlMode.setMode(ArmMode.Manual);
    this.roverConnection.disconnect();
    this.baseStationConnection.disconnect();
  }

  private linkFailed(status: string, online: boolean, wasOnline: boolean): boolean {
    return status === 'error' || status === 'disconnected' || (wasOnline && !online);
  }
}
