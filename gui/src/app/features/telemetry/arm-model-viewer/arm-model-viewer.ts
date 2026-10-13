/**
 * Status-bar labels:
 * - 3D: LOADING, WAITING, READY, STALE, ERROR, UNAVAILABLE
 * - MOVE: DISCONNECTED, WAITING, PLANNING, EXECUTING, DONE, CANCELED, FAILED
 * - IK: DISCONNECTED, WAITING, SOLVING, VALID, UNREACHABLE, INVALID
 * - MODE: em dash, LOCKED, UNLOCKED
 */
import { Component, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { ArmIkCoordinator } from '../../../core/arm/ik/arm-ik-coordinator';
import { RosConnection } from '../../../core/ros/ros-connection';
import { RosHeartbeatMonitor } from '../../../core/ros/ros-heartbeat-monitor';
import { ArmModelScene } from './arm-model-scene/arm-model-scene';
import type { ArmModelSceneState, ArmModelSceneStatus } from './arm-model-scene/arm-model-scene';

@Component({
  selector: 'app-arm-model-viewer',
  imports: [MatIconModule, ArmModelScene],
  templateUrl: './arm-model-viewer.html',
  styleUrl: './arm-model-viewer.scss',
})
export class ArmModelViewer {
  private readonly armIkCoordinator = inject(ArmIkCoordinator);
  private readonly rosConnection = inject(RosConnection);
  private readonly rosHeartbeatMonitor = inject(RosHeartbeatMonitor);

  readonly sceneState = signal<ArmModelSceneState>({
    status: 'unavailable',
    telemetryStale: false,
  });
  readonly viewerStatusLabel = computed(() => {
    const { status, telemetryStale } = this.sceneState();
    switch (status) {
      case 'loading':
        return 'LOADING';
      case 'waiting-telemetry':
        return 'WAITING';
      case 'ready':
        return telemetryStale ? 'STALE' : 'READY';
      case 'error':
        return 'ERROR';
      default:
        return 'UNAVAILABLE';
    }
  });

  readonly ikStatus = this.armIkCoordinator.status;
  readonly ikStatusLabel = this.armIkCoordinator.statusLabel;
  readonly orientationMode = this.armIkCoordinator.orientationMode;
  readonly executionStatus = this.armIkCoordinator.executionStatus;
  readonly baseStationAvailable = this.rosHeartbeatMonitor.baseStationAvailable;
  readonly roverAvailable = this.rosHeartbeatMonitor.roverAvailable;
  readonly moveAvailable = computed(() => this.baseStationAvailable() && this.roverAvailable());
  readonly executionStatusLabel = computed(() => {
    switch (this.executionStatus()) {
      case 'planning':
        return 'PLANNING';
      case 'executing':
        return 'EXECUTING';
      case 'succeeded':
        return 'DONE';
      case 'canceled':
        return 'CANCELED';
      case 'failed':
        return 'FAILED';
      default:
        return 'WAITING';
    }
  });
  readonly rosConnected = this.rosConnection.isConnected;

  onSceneStateChange(state: ArmModelSceneState): void {
    this.sceneState.set(state);
  }
}
