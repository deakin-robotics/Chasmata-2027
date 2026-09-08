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
  | { label: 'DRIVE'; confirmed: DriveMode | null; commanded: DriveMode | null }
  | { label: 'ARM'; confirmed: ArmMode | null; commanded: ArmMode | null }
  | { label: 'LAW'; confirmed: LawMode; commanded: null }
  | { label: 'SYSTEM'; confirmed: SystemMode; commanded: SystemMode | null }
  | { label: 'LINK'; confirmed: LinkMode; commanded: LinkMode | null };

/** Holds confirmed and commanded FMA state for the operator displays. */
@Service()
export class FmaStateService {
  private readonly columnsState = signal<FmaColumn[]>([
    { label: 'DRIVE', confirmed: null, commanded: null },
    { label: 'ARM', confirmed: null, commanded: null },
    { label: 'LAW', confirmed: LawMode.Normal, commanded: null },
    { label: 'SYSTEM', confirmed: SystemMode.Good, commanded: null },
    { label: 'LINK', confirmed: LinkMode.Good, commanded: null },
  ]);

  readonly columns = this.columnsState.asReadonly();

  /** Records a requested DRIVE mode without changing the confirmed state. */
  requestDriveMode(mode: DriveMode): void {
    this.updateDrive((column) => ({
      ...column,
      commanded: mode === column.confirmed ? null : mode,
    }));
  }

  /** Applies rover-confirmed DRIVE feedback and clears its pending request. */
  confirmDriveMode(mode: DriveMode): void {
    this.updateDrive((column) => ({ ...column, confirmed: mode, commanded: null }));
  }

  /** Clears a rejected or timed-out DRIVE request. */
  rejectDriveMode(): void {
    this.updateDrive((column) => ({ ...column, commanded: null }));
  }

  /** Records a requested ARM mode without changing the confirmed state. */
  requestArmMode(mode: ArmMode): void {
    this.updateArm((column) => ({
      ...column,
      commanded: mode === column.confirmed ? null : mode,
    }));
  }

  /** Applies rover-confirmed ARM feedback and clears its pending request. */
  confirmArmMode(mode: ArmMode): void {
    this.updateArm((column) => ({ ...column, confirmed: mode, commanded: null }));
  }

  /** Clears a rejected or timed-out ARM request. */
  rejectArmMode(): void {
    this.updateArm((column) => ({ ...column, commanded: null }));
  }

  /** Clears DRIVE and ARM state when the rover connection is unavailable. */
  resetControlModes(): void {
    this.columnsState.update((columns) =>
      columns.map((column) => {
        if (column.label === 'DRIVE' || column.label === 'ARM') {
          return { ...column, confirmed: null, commanded: null };
        }

        return column;
      }),
    );
  }

  private updateDrive(
    update: (
      column: Extract<FmaColumn, { label: 'DRIVE' }>,
    ) => Extract<FmaColumn, { label: 'DRIVE' }>,
  ): void {
    this.columnsState.update((columns) =>
      columns.map((column) => (column.label === 'DRIVE' ? update(column) : column)),
    );
  }

  private updateArm(
    update: (column: Extract<FmaColumn, { label: 'ARM' }>) => Extract<FmaColumn, { label: 'ARM' }>,
  ): void {
    this.columnsState.update((columns) =>
      columns.map((column) => (column.label === 'ARM' ? update(column) : column)),
    );
  }
}
