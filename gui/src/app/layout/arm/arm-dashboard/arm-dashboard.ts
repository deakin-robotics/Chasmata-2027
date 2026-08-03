import { Component, signal } from '@angular/core';

import { CameraStream } from '../../../features/cameras/camera-stream/camera-stream';
import { ArmSchematic } from '../../../features/telemetry/arm-schematic/arm-schematic';
import { ArmControlPanel } from '../arm-control-panel/arm-control-panel';
import { ArmRoverCameraLayout } from '../arm-rover-camera-layout/arm-rover-camera-layout';

/**
 * Arm operator workspace.
 *
 * This placeholder establishes the dedicated Arm route without activating
 * camera streams, telemetry subscriptions, or control publishers.
 */
@Component({
  selector: 'app-arm-dashboard',
  imports: [ArmControlPanel, ArmRoverCameraLayout, ArmSchematic, CameraStream],
  templateUrl: './arm-dashboard.html',
  styleUrl: './arm-dashboard.scss',
})
export class ArmDashboard {
  readonly armCameraUrl = signal('http://dcr-rover.local:8091/?action=stream');
}
