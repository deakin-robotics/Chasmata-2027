import { Component, computed, inject, input } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';

import { BaseStationConnection } from '../../../core/ros/base-station-connection';
import { RosConnection } from '../../../core/ros/ros-connection';
import { RosHeartbeatMonitor } from '../../../core/ros/ros-heartbeat-monitor';
import { ActionButton, ActionButtonTone } from '../../../shared/action-button/action-button';
import { ConnectionManager } from '../connection-manager/connection-manager';

export type RosConnectionTarget = 'rover' | 'basestation';

@Component({
  selector: 'app-ros-connection-button',
  imports: [ActionButton],
  templateUrl: './ros-connection-button.html',
  styleUrl: './ros-connection-button.scss',
})
export class RosConnectionButton {
  readonly target = input.required<RosConnectionTarget>();

  private readonly roverConnection = inject(RosConnection);
  private readonly baseStationConnection = inject(BaseStationConnection);
  private readonly heartbeatMonitor = inject(RosHeartbeatMonitor);
  private readonly dialog = inject(MatDialog);

  readonly label = computed(() => (this.target() === 'rover' ? 'Rover Link' : 'BaseStation Link'));
  readonly actionLabel = computed(() => {
    if (this.target() === 'rover') {
      switch (this.heartbeatMonitor.roverStatus()) {
        case 'connecting':
          return 'Connecting';
        case 'waiting-for-rover':
          return 'Standby';
        case 'connected':
          return 'Connected';
        case 'reconnecting':
          return 'Reconnecting';
        case 'error':
          return 'Retry';
        default:
          return 'Connect';
      }
    }

    switch (this.baseStationConnection.status()) {
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
  readonly tone = computed<ActionButtonTone>(() => {
    if (this.target() === 'rover') {
      switch (this.heartbeatMonitor.roverStatus()) {
        case 'connected':
          return 'normal';
        case 'error':
          return 'caution';
        default:
          return 'info';
      }
    }

    switch (this.baseStationConnection.status()) {
      case 'connected':
        return 'normal';
      case 'error':
        return 'caution';
      default:
        return 'info';
    }
  });
  readonly busy = computed(() =>
    this.target() === 'rover'
      ? this.heartbeatMonitor.isRoverConnecting()
      : this.baseStationConnection.isConnecting(),
  );

  openSettings(): void {
    this.dialog.open(ConnectionManager, {
      ariaLabel: `${this.label()} connection settings`,
      data: { target: this.target() },
      width: 'min(100% - 2rem, 32rem)',
    });
  }
}
