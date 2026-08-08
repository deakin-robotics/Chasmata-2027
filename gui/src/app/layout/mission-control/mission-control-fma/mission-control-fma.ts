import { Component } from '@angular/core';

export enum DriveMode {
  Manual = 'MANUAL',
  Managed = 'MANAGED',
  Hold = 'HOLD',
}

export enum NavMode {
  Selected = 'SELECTED',
  Managed = 'MANAGED',
  Waypoint = 'WAYPOINT',
  Return = 'RETURN',
}

export enum ArmMode {
  Manual = 'MANUAL',
  Managed = 'MANAGED',
  Position = 'POSITION',
  Hold = 'HOLD',
}

export enum LawMode {
  Normal = 'NORMAL',
  Alternate = 'ALTERNATE',
  Direct = 'DIRECT',
}

export enum SystemMode {
  Ros = 'ROS',
  Gamepad = 'GAMEPAD',
  Auto = 'AUTO',
  Fault = 'FAULT',
}

type FmaColumn =
  | { label: 'DRIVE'; active: DriveMode; armed: DriveMode }
  | { label: 'NAV'; active: NavMode; armed: NavMode }
  | { label: 'ARM'; active: ArmMode; armed: ArmMode }
  | { label: 'LAW'; active: LawMode; armed: LawMode }
  | { label: 'SYSTEM'; active: SystemMode; armed: SystemMode };

@Component({
  selector: 'app-mission-control-fma',
  templateUrl: './mission-control-fma.html',
  styleUrl: './mission-control-fma.scss',
})
export class MissionControlFma {
  readonly columns: FmaColumn[] = [
    { label: 'DRIVE', active: DriveMode.Manual, armed: DriveMode.Managed },
    { label: 'NAV', active: NavMode.Selected, armed: NavMode.Managed },
    { label: 'ARM', active: ArmMode.Manual, armed: ArmMode.Managed },
    { label: 'LAW', active: LawMode.Normal, armed: LawMode.Alternate },
    { label: 'SYSTEM', active: SystemMode.Ros, armed: SystemMode.Auto },
  ];
}
