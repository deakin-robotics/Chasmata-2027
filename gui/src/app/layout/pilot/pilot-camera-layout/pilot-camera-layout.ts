import { Component, signal } from '@angular/core';
import { CameraStream } from '../../../features/cameras/camera-stream/camera-stream';
import { RoverSchematic } from '../../../features/telemetry/rover-schematic/rover-schematic';

/**
 * Arranges the Pilot camera feeds around the reusable rover schematic.
 *
 * This component owns only the Pilot camera layout. A future bird's-eye view
 * will be composed beside it by the parent Pilot dashboard.
 */
@Component({
  selector: 'app-pilot-camera-layout',
  imports: [CameraStream, RoverSchematic],
  templateUrl: './pilot-camera-layout.html',
  styleUrl: './pilot-camera-layout.scss',
})
export class PilotCameraLayout {
  readonly frontCameraUrl = signal('http://dcr-rover.local:8080/?action=stream');
  readonly leftCameraUrl = signal('');
  readonly rightCameraUrl = signal('');
  readonly rearCameraUrl = signal('http://dcr-rover.local:8090/?action=stream');
}
