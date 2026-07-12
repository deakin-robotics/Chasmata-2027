import { Component } from '@angular/core';
import { PilotCameraLayout } from './pilot-camera-layout/pilot-camera-layout';

/**
 * Pilot operator workspace.
 *
 * It composes Pilot-specific visual layouts, including the camera layout and
 * a future bird's-eye view. Drive telemetry and controls will be added later.
 */
@Component({
  selector: 'app-pilot-dashboard',
  imports: [PilotCameraLayout],
  templateUrl: './pilot-dashboard.html',
  styleUrl: './pilot-dashboard.scss',
})
export class PilotDashboard {}
