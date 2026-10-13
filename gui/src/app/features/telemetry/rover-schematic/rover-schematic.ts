import { Component, computed, inject, signal } from '@angular/core';

import { ArmTelemetryService } from '../../../core/arm/telemetry/arm-telemetry.service';

const ARM_BASE_X = 160;
const ARM_BASE_Y = 165;
const ARM_SCHEMATIC_SCALE = 150;
const ARM_SHOULDER_LINK_LENGTH = 0.5;
const ARM_ELBOW_LINK_LENGTH = 0.6;
const ARM_J4_LATERAL_OFFSET = 0.08;
const ARM_J4_WRIST_OFFSET = 0.05;

/**
 * Top-down ECAM-style rover representation with a telemetry-driven arm.
 *
 * It intentionally has no ROS subscriptions or control behaviour. Future
 * shared arm telemetry provides the authoritative joint state.
 */
@Component({
  selector: 'app-rover-schematic',
  templateUrl: './rover-schematic.html',
  styleUrl: './rover-schematic.scss',
})
export class RoverSchematic {
  private readonly armTelemetry = inject(ArmTelemetryService);

  /** Commanded gimbal yaw in degrees; 0° means facing the rover front. */
  readonly commandedGimbalYawDeg = signal(90);
  readonly actualGimbalYawDeg = signal(0);
  /** Live arm heading in degrees; 0° means facing the rover front. */
  readonly actualArmYawDeg = computed<number | null>(() => {
    const projectedPosition = this.projectedArmPosition();
    if (!projectedPosition) return null;

    return this.toDegrees(Math.atan2(projectedPosition[0], projectedPosition[1]));
  });
  /** Approximate projected distance from the arm base to the J4 pivot in SVG units. */
  readonly actualArmLength = computed<number | null>(() => {
    const projectedPosition = this.projectedArmPosition();
    if (!projectedPosition) return null;

    return Math.hypot(projectedPosition[0], projectedPosition[1]) * ARM_SCHEMATIC_SCALE;
  });

  readonly commandedGimbalArcPath = computed(() =>
    this.buildGimbalArcPath(this.commandedGimbalYawDeg()),
  );
  readonly actualGimbalArcPath = computed(() => this.buildGimbalArcPath(this.actualGimbalYawDeg()));

  private buildGimbalArcPath(yawDeg: number): string {
    const centreX = 160;
    const centreY = 198;
    const radius = 140;
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

  private toDegrees(radians: number): number {
    return (radians * 180) / Math.PI;
  }

  private projectedArmPosition(): readonly [number, number] | null {
    const jointAngles = this.armTelemetry.actualJointAngles();
    if (!jointAngles || !this.hasArmJointState(jointAngles)) return null;

    const shoulder = jointAngles['shoulder_joint'];
    const elbow = jointAngles['elbow_joint'];
    const armPlaneAngle = Math.PI / 2 + shoulder - elbow;
    const localX = ARM_J4_LATERAL_OFFSET;
    const localY =
      ARM_SHOULDER_LINK_LENGTH * Math.cos(shoulder) +
      ARM_J4_WRIST_OFFSET * Math.cos(armPlaneAngle) -
      ARM_ELBOW_LINK_LENGTH * Math.sin(armPlaneAngle);
    const base = jointAngles['base_joint'];
    const projectedX = Math.cos(base) * localX + Math.sin(base) * localY;
    const projectedY = -Math.sin(base) * localX + Math.cos(base) * localY;

    return Number.isFinite(projectedX) && Number.isFinite(projectedY)
      ? [projectedX, projectedY]
      : null;
  }

  private hasArmJointState(jointAngles: Readonly<Record<string, number>>): boolean {
    return ['base_joint', 'shoulder_joint', 'elbow_joint'].every((name) =>
      Number.isFinite(jointAngles[name]),
    );
  }
}
