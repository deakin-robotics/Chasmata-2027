import { Component } from '@angular/core';
import { BirdView } from '../../features/cameras/bird-view/bird-view';
import { PilotCameraLayout } from './pilot-camera-layout/pilot-camera-layout';

/**
 * Pilot operator workspace.
 *
 * It composes the visual layouts and controls used by the rover pilot.
 */
@Component({
  selector: 'app-pilot-dashboard',
  imports: [BirdView, PilotCameraLayout],
  templateUrl: './pilot-dashboard.html',
  styleUrl: './pilot-dashboard.scss',
})
export class PilotDashboard {}
