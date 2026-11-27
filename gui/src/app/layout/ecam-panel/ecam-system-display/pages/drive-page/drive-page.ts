import { Component, effect, inject, OnDestroy } from '@angular/core';
import { Topic } from 'roslib';
import { DriveViewService } from '../../../../../core/drive/drive-view.service';
import { RosConnection } from '../../../../../core/ros/ros-connection';
import { RosHeartbeatMonitor } from '../../../../../core/ros/ros-heartbeat-monitor';
import { DriveTelemetryService } from '../../../../../core/drive/drive-telemetry.service';

@Component({
  selector: 'app-drive-page',
  templateUrl: './drive-page.html',
  styleUrl: './drive-page.scss',
})
export class DrivePage implements OnDestroy {
  private readonly telemetry = inject(DriveTelemetryService);
  private readonly view = inject(DriveViewService);
  private readonly connection = inject(RosConnection);
  private readonly heartbeat = inject(RosHeartbeatMonitor);
  private readonly clientId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  private readonly demandEffect = effect((onCleanup) => {
    const client = this.connection.client();
    if (!client || !this.heartbeat.roverAvailable()) return;
    const topic = new Topic({ ros: client, name: '/telemetry/drive/demand', messageType: 'telemetry_interfaces/msg/DriveTelemetryDemand' });
    const send = (active: boolean) => topic.publish({ client_id: this.clientId, active });
    send(true);
    const timer = setInterval(() => send(true), 1000);
    onCleanup(() => { clearInterval(timer); try { send(false); } catch { /* lease expires on disconnect */ } topic.unadvertise(); });
  });
  constructor() { this.view.active.set(true); }
  ngOnDestroy(): void { this.view.active.set(false); }
  linear(command = false): string {
    const value = command ? this.telemetry.linearCommand() : this.telemetry.odometry()?.speed;
    return value == null ? '--' : value.toFixed(2);
  }
  odometryValue(field: 'y' | 'heading' | 'angularSpeed'): string {
    const value = this.telemetry.odometry()?.[field];
    return value === undefined ? '--' : (field === 'heading' ? value * 180 / Math.PI : value).toFixed(2);
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
