import { Component, inject } from '@angular/core';

import { CameraFeedControl } from '../../../features/cameras/camera-feed-control';
import { CameraStream } from '../../../features/cameras/camera-stream/camera-stream';
import { CAMERA_SOURCES } from '../../../features/cameras/camera-sources';
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
  providers: [CameraFeedControl],
  templateUrl: './driver-dashboard.html',
  styleUrl: './driver-dashboard.scss',
})
export class DriverDashboard {
  readonly cameraFeedControl = inject(CameraFeedControl);
  readonly armCamera = CAMERA_SOURCES.arm;
  readonly frontCamera = CAMERA_SOURCES.front;
  readonly gimbalCamera = CAMERA_SOURCES.gimbal;
}
