import { Component, inject } from '@angular/core';
import { DriveTelemetryService } from '../../../../../core/drive/drive-telemetry.service';

@Component({
  selector: 'app-drive-page',
  templateUrl: './drive-page.html',
  styleUrl: './drive-page.scss',
})
export class DrivePage {
  private readonly telemetry = inject(DriveTelemetryService);
  temperature(wheel: number): string {
    const value = this.telemetry.rawTemperatures()[wheel];
    return value === undefined ? '--' : String(value);
  }
  value(name: string, command = false): string {
    const value = (command ? this.telemetry.wheelCommands() : this.telemetry.wheelVelocities())?.[name];
    return value === undefined ? '--' : value.toFixed(2);
  }
}
