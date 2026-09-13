import { Service, computed, signal } from '@angular/core';

import { ArmOverrideCommand, ArmOverrideState } from '../control/arm/arm-override';

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

type ArmOverrideTelemetry = {
  state: ArmOverrideState | null;
  pending: ArmOverrideCommand | null;
};

export enum SystemMode {
  Good = 'GOOD',
  Degraded = 'DEGRADED',
  Fault = 'FAULT',
  EStop = 'E-STOP',
}

export type GimbalPriorityOwner = 'DRIVER' | 'ARM OPS';

export type FmaColumn =
  | { label: 'DRIVE'; confirmed: DriveMode | null; commanded: DriveMode | null }
  | { label: 'ARM'; confirmed: ArmMode | null; commanded: ArmMode | null }
  | { label: 'LAW'; confirmed: LawMode | null }
  | {
      label: 'GIMBAL';
      confirmed: GimbalPriorityOwner | null;
      commanded: GimbalPriorityOwner | null;
    }
  | { label: 'SYSTEM'; confirmed: SystemMode | null; commanded: SystemMode | null };

/** Holds shared FMA state for the operator displays. */
@Service()
export class FmaStateService {
  private readonly columnsState = signal<FmaColumn[]>([
    { label: 'DRIVE', confirmed: null, commanded: null },
    { label: 'ARM', confirmed: null, commanded: null },
    { label: 'LAW', confirmed: null },
    { label: 'GIMBAL', confirmed: null, commanded: null },
    { label: 'SYSTEM', confirmed: null, commanded: null },
  ]);
  private readonly armOverrideTelemetryState = signal<ArmOverrideTelemetry>({
    state: null,
    pending: null,
  });

  readonly columns = this.columnsState.asReadonly();
  readonly armOverrideState = computed(() => this.armOverrideTelemetryState().state);
  readonly armOverridePendingCommand = computed(() => this.armOverrideTelemetryState().pending);
  readonly armOverrideActive = computed(() => this.armOverrideState() === ArmOverrideState.Active);
  readonly armOverridePending = computed(
    () =>
      this.armOverridePendingCommand() === ArmOverrideCommand.Enable &&
      this.armOverrideState() !== ArmOverrideState.Active,
  );

  readonly gimbalPriorityOwner = computed(() => {
    const column = this.columnsState().find(
      (candidate): candidate is Extract<FmaColumn, { label: 'GIMBAL' }> =>
        candidate.label === 'GIMBAL',
    );
    return column?.confirmed ?? null;
  });
  readonly gimbalPriorityPending = computed(() => {
    const column = this.columnsState().find(
      (candidate): candidate is Extract<FmaColumn, { label: 'GIMBAL' }> =>
        candidate.label === 'GIMBAL',
    );
    return column?.commanded ?? null;
  });
  readonly gimbalPriorityDisplay = computed(() => {
    switch (this.gimbalPriorityOwner()) {
      case 'DRIVER':
        return '← DRIVER';
      case 'ARM OPS':
        return 'ARM OPS →';
      default:
        return 'PRIORITY UNK';
    }
  });
  readonly gimbalPriorityAriaLabel = computed(() => {
    switch (this.gimbalPriorityOwner()) {
      case 'DRIVER':
        return 'Gimbal priority: Driver';
      case 'ARM OPS':
        return 'Gimbal priority: Arm Operator';
      default:
        return 'Gimbal priority unknown';
    }
  });
  readonly gimbalPriorityPendingDisplay = computed(() => {
    const pending = this.gimbalPriorityPending();
    return pending ?? '';
  });
  readonly gimbalPriorityPendingAriaLabel = computed(() => {
    const pending = this.gimbalPriorityPending();
    return pending ? `Gimbal priority request pending: ${pending}` : '';
  });

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

  /** Applies rover telemetry for DRIVE without changing the public request flow. */
  setDriveTelemetry(confirmed: DriveMode | null, commanded: DriveMode | null): void {
    this.updateDrive((column) => ({ ...column, confirmed, commanded }));
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

  /** Applies rover telemetry for ARM without changing the public request flow. */
  setArmTelemetry(confirmed: ArmMode | null, commanded: ArmMode | null): void {
    this.updateArm((column) => ({ ...column, confirmed, commanded }));
  }

  /** Applies authoritative LAW telemetry, or clears it when unknown. */
  setLawMode(mode: LawMode | null): void {
    this.setLawTelemetry(mode);
  }

  /** Applies the authoritative LAW state reported by the rover. */
  setLawTelemetry(state: LawMode | null): void {
    this.updateColumn('LAW', (column) => ({ ...column, confirmed: state }));
  }

  /** Applies independent Arm Override telemetry reported inside the FMA bundle. */
  setArmOverrideTelemetry(
    state: ArmOverrideState | null,
    pending: ArmOverrideCommand | null,
  ): void {
    this.armOverrideTelemetryState.set({ state, pending });
  }

  /** Applies authoritative SYSTEM telemetry, or clears it when unknown. */
  setSystemMode(mode: SystemMode | null): void {
    this.updateColumn('SYSTEM', (column) => ({ ...column, confirmed: mode, commanded: null }));
  }

  /** Applies authoritative gimbal-priority telemetry, or clears it when unknown. */
  setGimbalPriorityOwner(owner: GimbalPriorityOwner | null): void {
    this.setGimbalPriorityTelemetry(owner, null);
  }

  /** Applies authoritative Gimbal priority telemetry, including pending takeover. */
  setGimbalPriorityTelemetry(
    confirmed: GimbalPriorityOwner | null,
    commanded: GimbalPriorityOwner | null,
  ): void {
    this.updateColumn('GIMBAL', (column) => ({ ...column, confirmed, commanded }));
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

  private updateColumn<T extends FmaColumn['label']>(
    label: T,
    update: (column: Extract<FmaColumn, { label: T }>) => Extract<FmaColumn, { label: T }>,
  ): void {
    this.columnsState.update((columns) =>
      columns.map((column) =>
        column.label === label ? update(column as Extract<FmaColumn, { label: T }>) : column,
      ),
    );
  }
}
