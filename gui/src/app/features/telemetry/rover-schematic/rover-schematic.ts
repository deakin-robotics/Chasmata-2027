import { Component, computed, signal } from '@angular/core';

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
export class RoverSchematic {
  /** Commanded gimbal yaw in degrees; 0° means facing the rover front. */
  readonly commandedGimbalYawDeg = signal(90);
  readonly actualGimbalYawDeg = signal(0);
  /** Arm yaw in degrees; 0° means facing the rover front. */
  readonly commandedArmYawDeg = signal(0);
  readonly actualArmYawDeg = signal(0);

  readonly commandedGimbalArcPath = computed(() =>
    this.buildGimbalArcPath(this.commandedGimbalYawDeg()),
  );
  readonly actualGimbalArcPath = computed(() => this.buildGimbalArcPath(this.actualGimbalYawDeg()));

  private buildGimbalArcPath(yawDeg: number): string {
    const centreX = 160;
    const centreY = 198;
    const radius = 135;
    const halfSpanDeg = 10;
    const startAngle = this.toRadians(yawDeg - halfSpanDeg);
    const endAngle = this.toRadians(yawDeg + halfSpanDeg);
    const startX = centreX + radius * Math.sin(startAngle);
    const startY = centreY - radius * Math.cos(startAngle);
    const endX = centreX + radius * Math.sin(endAngle);
    const endY = centreY - radius * Math.cos(endAngle);

    return `M${startX} ${startY}A${radius} ${radius} 0 0 1 ${endX} ${endY}`;
  }

  private toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }
}
