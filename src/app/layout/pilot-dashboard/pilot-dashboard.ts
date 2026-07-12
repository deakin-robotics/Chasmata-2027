import { Component } from '@angular/core';
import { RoverSchematic } from '../../features/telemetry/rover-schematic/rover-schematic';

/**
 * Pilot operator workspace.
 *
 * Camera feeds, drive telemetry, and controls will be added here in later
 * milestones. It currently establishes the Pilot-owned location for the
 * reusable rover schematic.
 */
@Component({
  selector: 'app-pilot-dashboard',
  imports: [RoverSchematic],
  templateUrl: './pilot-dashboard.html',
  styleUrl: './pilot-dashboard.scss',
})
export class PilotDashboard {}
