import { Component, inject } from '@angular/core';
import { DriveTelemetryService } from '../../../../../core/drive/drive-telemetry.service';

@Component({
  selector: 'app-drive-page',
  templateUrl: './drive-page.html',
  styleUrl: './drive-page.scss',
})
export class DrivePage {
  private readonly telemetry = inject(DriveTelemetryService);
  linear(command = false): string {
    const value = command ? this.telemetry.linearCommand() : this.telemetry.odometry()?.speed;
    return value == null ? '--' : value.toFixed(2);
  }
  displacement(): string {
    const value = this.telemetry.odometry()?.x;
    return value === undefined ? '--' : value.toFixed(2);
  }
  temperature(wheel: number): string {
    const value = this.telemetry.rawTemperatures()[wheel];
    return value === undefined ? '--' : String(value);
  }
  current(wheel: number): string {
    const value = this.telemetry.rawCurrents()[wheel];
    return value === undefined ? '--' : String(value);
  }
  value(name: string, command = false): string {
    const value = (command ? this.telemetry.wheelCommands() : this.telemetry.wheelVelocities())?.[name];
    return value === undefined ? '--' : value.toFixed(2);
  }
}
