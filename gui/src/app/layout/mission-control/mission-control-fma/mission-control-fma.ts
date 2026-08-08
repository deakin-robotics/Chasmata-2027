import { Component } from '@angular/core';

export enum DriveMode {
  Manual = 'MANUAL',
  Velocity = 'VELOCITY',
  Managed = 'MANAGED',
}

export enum ArmMode {
  Manual = 'MANUAL',
  Managed = 'MANAGED',
  Position = 'POSITION',
  Stowed = 'STOWED',
}

export enum LawMode {
  Normal = 'NORMAL',
  Alternate = 'ALTERNATE',
  Direct = 'DIRECT',
}

export enum SystemMode {
  Ready = 'READY',
  Degraded = 'DEGRADED',
  Fault = 'FAULT',
  EStop = 'E-STOP',
}

export enum LinkMode {
  Good = 'GOOD',
  Degraded = 'DEGRADED',
  Lost = 'LOST',
}

type FmaColumn =
  | { label: 'DRIVE'; active: DriveMode; armed: DriveMode }
  | { label: 'ARM'; active: ArmMode; armed: ArmMode }
  | { label: 'LAW'; active: LawMode; armed: null }
  | { label: 'SYSTEM'; active: SystemMode; armed: SystemMode | null }
  | { label: 'LINK'; active: LinkMode; armed: LinkMode | null };

@Component({
  selector: 'app-mission-control-fma',
  templateUrl: './mission-control-fma.html',
  styleUrl: './mission-control-fma.scss',
})
export class MissionControlFma {
  readonly columns: FmaColumn[] = [
    { label: 'DRIVE', active: DriveMode.Manual, armed: DriveMode.Managed },
    { label: 'ARM', active: ArmMode.Manual, armed: ArmMode.Managed },
    { label: 'LAW', active: LawMode.Normal, armed: null },
    { label: 'SYSTEM', active: SystemMode.Ready, armed: null },
    { label: 'LINK', active: LinkMode.Good, armed: null },
  ];
}
