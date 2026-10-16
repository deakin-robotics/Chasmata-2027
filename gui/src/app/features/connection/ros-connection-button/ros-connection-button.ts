import { Component, computed, inject } from '@angular/core';
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
  readonly label = 'ROS Link';
  readonly checked = computed(() => {
    const roverStatus = this.roverConnection.status();
    const baseStationStatus = this.baseStationConnection.status();

    return roverStatus !== 'disconnected' || baseStationStatus !== 'disconnected';
  });
  readonly tone = computed<ControlSwitchTone>(() => {
    const roverStatus = this.roverConnection.status();
    const baseStationStatus = this.baseStationConnection.status();

    if (this.heartbeatMonitor.roverAvailable() && this.heartbeatMonitor.baseStationAvailable()) {
      return 'normal';
    }

    if (roverStatus === 'error' || baseStationStatus === 'error') return 'critical';
    if (this.roverConnection.isConnecting() || this.baseStationConnection.isConnecting()) return 'info';
    if (this.checked()) return 'caution';
    return 'neutral';
  });

  setConnected(connected: boolean): void {
    if (connected) {
      this.roverConnection.connect(environment.rosbridgeUrl);
      this.baseStationConnection.connect(environment.basestationRosbridgeUrl);
      return;
    }

    this.roverConnection.disconnect();
    this.baseStationConnection.disconnect();
  }
}
