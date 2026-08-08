import { Component, signal } from '@angular/core';

import { CameraStream } from '../../../features/cameras/camera-stream/camera-stream';
import { RoverSchematic } from '../../../features/telemetry/rover-schematic/rover-schematic';

/** Front/rear rover camera awareness for the Arm operator. */
@Component({
  selector: 'app-arm-rover-camera-layout',
  imports: [CameraStream, RoverSchematic],
  templateUrl: './arm-rover-camera-layout.html',
  styleUrl: './arm-rover-camera-layout.scss',
})
export class ArmRoverCameraLayout {
  readonly frontCameraUrl = signal('http://dcr-rover.local:8080/?action=stream');
  readonly rearCameraUrl = signal('http://dcr-rover.local:8090/?action=stream');
}
