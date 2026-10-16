import { Component, computed, inject } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { BaseStationConnection } from '../../../core/ros/base-station-connection';
import { RosConnection } from '../../../core/ros/ros-connection';
import { RosHeartbeatMonitor } from '../../../core/ros/ros-heartbeat-monitor';
import { ActionButton, ActionButtonTone } from '../../../shared/action-button/action-button';

/** Opens the fixed Rover and BaseStation ROS links for the hosted operations GUI. */
@Component({ selector: 'app-ros-connection-button', imports: [ActionButton], templateUrl: './ros-connection-button.html', styleUrl: './ros-connection-button.scss' })
export class RosConnectionButton {
  private readonly roverConnection = inject(RosConnection);
  private readonly baseStationConnection = inject(BaseStationConnection);
  private readonly heartbeatMonitor = inject(RosHeartbeatMonitor);
  readonly label = 'ROS Link';
  readonly actionLabel = computed(() => {
    switch (this.heartbeatMonitor.roverStatus()) {
      case 'connecting': return 'Connecting'; case 'waiting-for-rover': return 'Standby'; case 'connected': return 'Connected'; case 'reconnecting': return 'Reconnecting'; case 'error': return 'Retry'; default: return 'Connect';
    }
  });
  readonly tone = computed<ActionButtonTone>(() => this.heartbeatMonitor.roverStatus() === 'connected' ? 'normal' : this.heartbeatMonitor.roverStatus() === 'error' ? 'caution' : 'info');
  readonly busy = computed(() => this.heartbeatMonitor.isRoverConnecting() || this.baseStationConnection.isConnecting());
  connect(): void { this.roverConnection.connect(environment.rosbridgeUrl); this.baseStationConnection.connect(environment.basestationRosbridgeUrl); }
}
