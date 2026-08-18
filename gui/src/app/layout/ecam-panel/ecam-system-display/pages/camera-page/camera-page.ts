import { Component } from '@angular/core';

@Component({
  selector: 'app-camera-page',
  templateUrl: './camera-page.html',
  styleUrl: './camera-page.scss',
})
export class CameraPage {
  readonly mockPanAngle = 90;
  readonly mockTiltAngle = 50;
}
