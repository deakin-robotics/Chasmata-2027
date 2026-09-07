import { Component, signal } from '@angular/core';

import { CameraStream } from '../../../features/cameras/camera-stream/camera-stream';
import { GamepadControlPanel } from '../../../features/gamepad/gamepad-control-panel/gamepad-control-panel';
import { ArmSchematic } from '../../../features/telemetry/arm-schematic/arm-schematic';
import { ControlScheme } from '../../../shared/control-scheme/control-scheme';
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
  imports: [ArmControlPanel, ArmRoverCameraLayout, ArmSchematic, CameraStream, ControlScheme, GamepadControlPanel],
  templateUrl: './arm-dashboard.html',
  styleUrl: './arm-dashboard.scss',
})
export class ArmDashboard {
  readonly armCameraUrl = signal('http://dcr-rover.local:8091/?action=stream');
  readonly gimbalCameraUrl = signal('');
}
