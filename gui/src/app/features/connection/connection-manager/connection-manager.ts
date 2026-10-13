import { Component, computed, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatDialogRef } from '@angular/material/dialog';
import { RosConnection } from '../../../core/ros/ros-connection';
import {
  RosHeartbeatMonitor,
  RoverConnectionStatus,
} from '../../../core/ros/ros-heartbeat-monitor';
import { environment } from '../../../../environments/environment';

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
  readonly rosConnection = inject(RosConnection);
  readonly heartbeatMonitor = inject(RosHeartbeatMonitor);
  private readonly dialogRef = inject(MatDialogRef<ConnectionManager>, { optional: true });

  readonly endpoint = new FormControl(this.rosConnection.url() ?? environment.rosbridgeUrl, {
    nonNullable: true,
    validators: [Validators.required],
  });

  readonly defaultEndpoint = environment.rosbridgeUrl;

  readonly canDisconnect = computed(() => {
    const status = this.rosConnection.status();
    return (
      status === 'connected' ||
      status === 'connecting' ||
      status === 'reconnecting'
    );
  });

  readonly statusLabel = computed(() =>
    this.getStatusLabel(this.heartbeatMonitor.roverStatus()),
  );

  readonly statusIcon = computed(() =>
    this.getStatusIcon(this.heartbeatMonitor.roverStatus()),
  );

  readonly statusDescription = computed(() => {
    const status = this.heartbeatMonitor.roverStatus();
    const attempt = this.rosConnection.reconnectAttempt();

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
  });

  connect(): void {
    this.endpoint.markAsTouched();
    if (this.endpoint.invalid || this.heartbeatMonitor.isRoverConnecting()) return;

    this.rosConnection.connect(this.endpoint.value);
    this.dialogRef?.close();
  }

  disconnect(): void {
    this.rosConnection.disconnect();
  }

  private getStatusLabel(status: RoverConnectionStatus): string {
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

  private getStatusIcon(status: RoverConnectionStatus): string {
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
}
