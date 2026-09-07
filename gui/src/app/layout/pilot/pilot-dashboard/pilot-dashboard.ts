import { Component, signal } from '@angular/core';

import { CameraStream } from '../../../features/cameras/camera-stream/camera-stream';
import { GamepadControlPanel } from '../../../features/gamepad/gamepad-control-panel/gamepad-control-panel';
import { RoverSchematic } from '../../../features/telemetry/rover-schematic/rover-schematic';
import { ControlScheme } from '../../../shared/control-scheme/control-scheme';
import { PilotControlPanel } from '../pilot-control-panel/pilot-control-panel';

/**
 * Pilot operator workspace.
 *
 * It composes the visual layouts and controls used by the rover pilot.
 */
@Component({
  selector: 'app-pilot-dashboard',
  imports: [CameraStream, ControlScheme, GamepadControlPanel, PilotControlPanel, RoverSchematic],
  templateUrl: './pilot-dashboard.html',
  styleUrl: './pilot-dashboard.scss',
})
export class PilotDashboard {
  readonly armCameraUrl = signal('http://dcr-rover.local:8091/?action=stream');
  readonly frontCameraUrl = signal('http://dcr-rover.local:8080/?action=stream');
  readonly gimbalCameraUrl = signal('');
}
