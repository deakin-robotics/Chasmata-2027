import { Component, signal } from '@angular/core';

import { CameraStream } from '../../../features/cameras/camera-stream/camera-stream';
import { GamepadControlPanel } from '../../../features/gamepad/gamepad-control-panel/gamepad-control-panel';
import { RoverSchematic } from '../../../features/telemetry/rover-schematic/rover-schematic';
import { ControlScheme } from '../../../shared/control-scheme/control-scheme';
import { DriverControlPanel } from '../driver-control-panel/driver-control-panel';

/**
 * Driver operator workspace.
 *
 * It composes the visual layouts and controls used by the rover driver.
 */
@Component({
  selector: 'app-driver-dashboard',
  imports: [CameraStream, ControlScheme, DriverControlPanel, GamepadControlPanel, RoverSchematic],
  templateUrl: './driver-dashboard.html',
  styleUrl: './driver-dashboard.scss',
})
export class DriverDashboard {
  readonly armCameraUrl = signal('http://localhost:8091/?action=stream');
  readonly frontCameraUrl = signal('http://localhost:8080/?action=stream');
  readonly gimbalCameraUrl = signal('http://localhost:8090/?action=stream');
}
