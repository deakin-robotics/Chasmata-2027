import { Component, computed, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { environment } from '../../../../environments/environment';
import { BaseStationConnection } from '../../../core/ros/base-station-connection';
import { RosConnection } from '../../../core/ros/ros-connection';
import {
  RosHeartbeatMonitor,
  RoverConnectionStatus,
} from '../../../core/ros/ros-heartbeat-monitor';
import { RosbridgeConnection, RosConnectionStatus } from '../../../core/ros/rosbridge-connection';
import type { RosConnectionTarget } from '../ros-connection-button/ros-connection-button';

interface ConnectionManagerData {
  target?: RosConnectionTarget;
}

type ConnectionStatus = RosConnectionStatus | RoverConnectionStatus;

@Component({
  selector: 'app-connection-manager',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  templateUrl: './connection-manager.html',
  styleUrl: './connection-manager.scss',
})
export class ConnectionManager {
  private readonly dialogData = inject<ConnectionManagerData | null>(MAT_DIALOG_DATA, {
    optional: true,
  });
  readonly target: RosConnectionTarget = this.dialogData?.target ?? 'rover';

  private readonly roverConnection = inject(RosConnection);
  private readonly baseStationConnection = inject(BaseStationConnection);
  private readonly heartbeatMonitor = inject(RosHeartbeatMonitor);
  private readonly dialogRef = inject(MatDialogRef<ConnectionManager>, { optional: true });

  readonly connection: RosbridgeConnection =
    this.target === 'rover' ? this.roverConnection : this.baseStationConnection;
  readonly connectionName = this.target === 'rover' ? 'Rover' : 'BaseStation';
  readonly defaultEndpoint =
    this.target === 'rover' ? environment.rosbridgeUrl : environment.basestationRosbridgeUrl;
  readonly endpoint = new FormControl(this.connection.url() ?? this.defaultEndpoint, {
    nonNullable: true,
    validators: [Validators.required],
  });

  readonly status = computed<ConnectionStatus>(() =>
    this.target === 'rover'
      ? this.heartbeatMonitor.roverStatus()
      : this.baseStationConnection.status(),
  );
  readonly isConnecting = computed(() =>
    this.target === 'rover'
      ? this.heartbeatMonitor.isRoverConnecting()
      : this.baseStationConnection.isConnecting(),
  );
  readonly canDisconnect = computed(() => {
    const status = this.status();
    return (
      status === 'connected' ||
      status === 'connecting' ||
      status === 'waiting-for-rover' ||
      status === 'reconnecting'
    );
  });
  readonly statusLabel = computed(() => this.getStatusLabel(this.status()));
  readonly statusIcon = computed(() => this.getStatusIcon(this.status()));
  readonly statusDescription = computed(() => this.getStatusDescription(this.status()));

  connect(): void {
    this.endpoint.markAsTouched();
    if (this.endpoint.invalid || this.canDisconnect()) return;

    this.connection.connect(this.endpoint.value);
    this.dialogRef?.close();
  }

  disconnect(): void {
    this.connection.disconnect();
  }

  private getStatusLabel(status: ConnectionStatus): string {
    switch (status) {
      case 'connecting':
        return 'Connecting';
      case 'waiting-for-rover':
        return 'Waiting for rover';
      case 'connected':
        return 'Connected';
      case 'reconnecting':
        return 'Reconnecting';
      case 'error':
        return 'Connection error';
      default:
        return 'Disconnected';
    }
  }

  private getStatusIcon(status: ConnectionStatus): string {
    switch (status) {
      case 'connecting':
      case 'waiting-for-rover':
      case 'reconnecting':
        return 'sync';
      case 'connected':
        return 'sensors';
      case 'error':
        return 'error';
      default:
        return 'sensors_off';
    }
  }

  private getStatusDescription(status: ConnectionStatus): string {
    if (this.target === 'basestation') {
      switch (status) {
        case 'connecting':
          return 'Opening the BaseStation ROSbridge WebSocket connection.';
        case 'connected':
          return 'BaseStation ROSbridge is connected.';
        case 'reconnecting':
          return 'Connection lost. Reconnecting to BaseStation ROSbridge.';
        case 'error':
          return 'BaseStation ROSbridge could not be reached. Check the endpoint and network.';
        default:
          return 'Enter the BaseStation ROSbridge endpoint to begin.';
      }
    }

    const attempt = this.roverConnection.reconnectAttempt();
    switch (status) {
      case 'connecting':
        return 'Opening the ROSbridge WebSocket connection.';
      case 'waiting-for-rover':
        return 'ROSbridge is reachable. Waiting for rover heartbeat.';
      case 'connected':
        return 'Rover heartbeat received. Rover controls are available.';
      case 'reconnecting':
        return attempt > 0
          ? `Connection lost. Reconnection attempt ${attempt} is in progress.`
          : 'Connection lost. Waiting to reconnect.';
      case 'error':
        return 'ROSbridge could not be reached. Check the endpoint and rover network.';
      default:
        return 'Enter the rover ROSbridge endpoint to begin.';
    }
  }
}
