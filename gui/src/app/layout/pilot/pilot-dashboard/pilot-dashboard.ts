import { Component } from '@angular/core';
import { BirdView } from '../../../features/cameras/bird-view/bird-view';
import { GamepadControlPanel } from '../../../features/gamepad/gamepad-control-panel/gamepad-control-panel';
import { PilotCameraLayout } from '../pilot-camera-layout/pilot-camera-layout';
import { PilotControlPanel } from '../pilot-control-panel/pilot-control-panel';

/**
 * Pilot operator workspace.
 *
 * It composes the visual layouts and controls used by the rover pilot.
 */
@Component({
  selector: 'app-pilot-dashboard',
  imports: [BirdView, GamepadControlPanel, PilotCameraLayout, PilotControlPanel],
  templateUrl: './pilot-dashboard.html',
  styleUrl: './pilot-dashboard.scss',
})
export class PilotDashboard {}
