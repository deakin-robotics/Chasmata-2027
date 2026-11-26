import { Component, inject } from '@angular/core';
import { ArmTelemetryService } from '../../../../../core/arm/telemetry/arm-telemetry.service';

@Component({
  selector: 'app-arm-page',
  templateUrl: './arm-page.html',
  styleUrl: './arm-page.scss',
})
export class ArmPage {
  private readonly telemetry = inject(ArmTelemetryService);
  readonly feedbackStatus = this.telemetry.feedbackStatus;
  command(name: string): string {
    const command = this.telemetry.commandFor(name);
    return command ? `${command.value.toFixed(1)} ${command.mode === 1 ? 'deg' : 'RPM'}` : '--';
  }
  motorValue(field: 'temperature' | 'current'): string {
    const motors = Object.values(this.telemetry.motors());
    if (motors.length === 0) return '--';
    return Math.max(...motors.map((motor) => field === 'current' ? Math.abs(motor.current) : motor.temperature)).toFixed(1);
  }
  value(name: string, velocity = false): string {
    if (this.telemetry.feedbackStatus() !== true) return '--';
    const value = (velocity ? this.telemetry.actualJointVelocities() : this.telemetry.actualJointAngles())?.[name];
    return value === undefined ? '--' : (value * 180 / Math.PI).toFixed(1);
  }
}
