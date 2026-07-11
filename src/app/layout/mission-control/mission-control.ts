import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterOutlet } from '@angular/router';
import { RosConnection } from '../../core/ros/ros-connection';
import { ConnectionManager } from '../../features/connection/connection-manager/connection-manager';

@Component({
  selector: 'app-mission-control',
  imports: [
    RouterOutlet,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    ConnectionManager,
  ],
  templateUrl: './mission-control.html',
  styleUrl: './mission-control.scss',
})
export class MissionControl {
  readonly rosConnection = inject(RosConnection);
  readonly connectionPanelOpen = signal(false);

  readonly connectionLabel = computed(() => {
    switch (this.rosConnection.status()) {
      case 'connecting':
        return 'Connecting';
      case 'connected':
        return 'ROS connected';
      case 'reconnecting':
        return 'Reconnecting';
      case 'error':
        return 'Connection error';
      default:
        return 'ROS disconnected';
    }
  });

  readonly connectionIcon = computed(() => {
    switch (this.rosConnection.status()) {
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
  });

  toggleConnectionPanel(): void {
    this.connectionPanelOpen.update((open) => !open);
  }

  closeConnectionPanel(): void {
    this.connectionPanelOpen.set(false);
  }
}
