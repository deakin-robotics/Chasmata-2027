import { Component } from '@angular/core';

import { CameraStream } from '../../../features/cameras/camera-stream/camera-stream';
import { CAMERA_SOURCES } from '../../../features/cameras/camera-sources';
import { GamepadControlPanel } from '../../../features/gamepad/gamepad-control-panel/gamepad-control-panel';
import { ArmModelViewer } from '../../../features/telemetry/arm-model-viewer/arm-model-viewer';
import { RoverSchematic } from '../../../features/telemetry/rover-schematic/rover-schematic';
import { ControlScheme } from '../../../shared/control-scheme/control-scheme';
import { ArmControlPanel } from '../arm-control-panel/arm-control-panel';

/**
 * Arm operator workspace.
 *
 * The dashboard keeps camera, telemetry, and control concerns in their own
 * components. The Arm model viewer renders the current URDF visual model.
 */
@Component({
  selector: 'app-arm-dashboard',
  imports: [
    ArmControlPanel,
    ArmModelViewer,
    CameraStream,
    ControlScheme,
    GamepadControlPanel,
    RoverSchematic,
  ],
  templateUrl: './arm-dashboard.html',
  styleUrl: './arm-dashboard.scss',
})
export class ArmDashboard {
  readonly frontCamera = CAMERA_SOURCES.front;
  readonly armCamera = CAMERA_SOURCES.arm;
  readonly gimbalCamera = CAMERA_SOURCES.gimbal;
}
