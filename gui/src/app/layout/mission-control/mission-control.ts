import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ControlModeCoordinator } from '../../core/control/control-mode-coordinator';
import { RosTelemetryBridge } from '../../core/ros/ros-telemetry-bridge';
import { MissionControlHeader } from './mission-control-header/mission-control-header';

@Component({
  selector: 'app-mission-control',
  imports: [RouterOutlet, MissionControlHeader],
  templateUrl: './mission-control.html',
  styleUrl: './mission-control.scss',
})
export class MissionControl {
  private readonly controlModeCoordinator = inject(ControlModeCoordinator);
  private readonly rosTelemetryBridge = inject(RosTelemetryBridge);
}
