import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { environment } from '../../../../environments/environment';
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
  private readonly roverWasOnline = signal(false);
  private readonly baseStationWasOnline = signal(false);
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
    const roverFailed = this.linkFailed(roverStatus, roverOnline, this.roverWasOnline());
    const baseStationFailed = this.linkFailed(
      baseStationStatus,
      baseStationOnline,
      this.baseStationWasOnline(),
    );

    if (roverOnline && baseStationOnline) return 'normal';
    if (roverFailed && baseStationFailed) return 'critical';
    if (roverFailed || baseStationFailed) return 'caution';
    return 'info';
  });
  readonly flashing = computed(() => this.checked() && this.tone() === 'info');

  private readonly onlineHistoryEffect = effect(() => {
    const checked = this.checked();
    const roverOnline = this.heartbeatMonitor.roverAvailable();
    const baseStationOnline = this.heartbeatMonitor.baseStationAvailable();

    untracked(() => {
      if (!checked) {
        this.roverWasOnline.set(false);
        this.baseStationWasOnline.set(false);
        return;
      }

      if (roverOnline) this.roverWasOnline.set(true);
      if (baseStationOnline) this.baseStationWasOnline.set(true);
    });
  });

  setConnected(connected: boolean): void {
    if (connected) {
      this.roverConnection.connect(environment.rosbridgeUrl);
      this.baseStationConnection.connect(environment.basestationRosbridgeUrl);
      return;
    }

    this.roverWasOnline.set(false);
    this.baseStationWasOnline.set(false);
    this.roverConnection.disconnect();
    this.baseStationConnection.disconnect();
  }

  private linkFailed(status: string, online: boolean, wasOnline: boolean): boolean {
    return status === 'error' || status === 'disconnected' || (wasOnline && !online);
  }
}
