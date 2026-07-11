import { Component } from '@angular/core';

/**
 * Static top-down ECAM-style rover representation.
 *
 * It intentionally has no ROS subscriptions or control behaviour. Future
 * telemetry layers can colour or annotate these visual elements without
 * changing how the Pilot and Arm dashboards reuse the schematic.
 */
@Component({
  selector: 'app-rover-schematic',
  templateUrl: './rover-schematic.html',
  styleUrl: './rover-schematic.scss',
})
export class RoverSchematic {}
