import { Component, computed, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatDialogRef } from '@angular/material/dialog';
import {
  RosConnection,
  RosConnectionStatus,
} from '../../../core/ros/ros-connection';

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
  private readonly dialogRef = inject(MatDialogRef<ConnectionManager>, { optional: true });

  readonly endpoint = new FormControl('localhost:9090', {
    nonNullable: true,
    validators: [Validators.required],
  });

  readonly canDisconnect = computed(() => {
    const status = this.rosConnection.status();
    return status === 'connected' || status === 'connecting' || status === 'reconnecting';
  });

  readonly statusLabel = computed(() =>
    this.getStatusLabel(this.rosConnection.status()),
  );

  readonly statusIcon = computed(() =>
    this.getStatusIcon(this.rosConnection.status()),
  );

  readonly statusDescription = computed(() => {
    const status = this.rosConnection.status();
    const attempt = this.rosConnection.reconnectAttempt();

    switch (status) {
      case 'connecting':
        return 'Opening the ROSbridge WebSocket connection.';
      case 'connected':
        return 'ROS topics and services are available to the GUI.';
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
    if (this.endpoint.invalid || this.rosConnection.isConnecting()) return;

    this.rosConnection.connect(this.endpoint.value);
    this.dialogRef?.close();
  }

  disconnect(): void {
    this.rosConnection.disconnect();
  }

  private getStatusLabel(status: RosConnectionStatus): string {
    switch (status) {
      case 'connecting':
        return 'Connecting';
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

  private getStatusIcon(status: RosConnectionStatus): string {
    switch (status) {
      case 'connecting':
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
