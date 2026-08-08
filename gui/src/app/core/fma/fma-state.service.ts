import { Service, signal } from '@angular/core';

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
  Good = 'GOOD',
  Degraded = 'DEGRADED',
  Fault = 'FAULT',
  EStop = 'E-STOP',
}

export enum LinkMode {
  Good = 'GOOD',
  Degraded = 'DEGRADED',
  Lost = 'LOST',
}

export type FmaColumn =
  | { label: 'DRIVE'; confirmed: DriveMode; commanded: DriveMode }
  | { label: 'ARM'; confirmed: ArmMode; commanded: ArmMode }
  | { label: 'LAW'; confirmed: LawMode; commanded: null }
  | { label: 'SYSTEM'; confirmed: SystemMode; commanded: SystemMode | null }
  | { label: 'LINK'; confirmed: LinkMode; commanded: LinkMode | null };

/** Holds the FMA state; the values are mock state until rover telemetry is available. */
@Service()
export class FmaStateService {
  private readonly columnsState = signal<FmaColumn[]>([
    { label: 'DRIVE', confirmed: DriveMode.Manual, commanded: DriveMode.Managed },
    { label: 'ARM', confirmed: ArmMode.Manual, commanded: ArmMode.Managed },
    { label: 'LAW', confirmed: LawMode.Normal, commanded: null },
    { label: 'SYSTEM', confirmed: SystemMode.Good, commanded: null },
    { label: 'LINK', confirmed: LinkMode.Good, commanded: null },
  ]);

  readonly columns = this.columnsState.asReadonly();
}
