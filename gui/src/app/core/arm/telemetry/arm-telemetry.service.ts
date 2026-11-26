import { Service, signal, OnDestroy } from '@angular/core';

import { ArmJointState } from '../ik/arm-ik-types';

/** Stores authoritative arm feedback received from the rover. */
@Service()
export class ArmTelemetryService implements OnDestroy {
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private statusExpiry: ReturnType<typeof setTimeout> | undefined;
  private readonly feedbackStatusState = signal<boolean | null>(null);
  readonly feedbackStatus = this.feedbackStatusState.asReadonly();
  private readonly motorState = signal<Readonly<Record<number, { temperature: number; current: number }>>>({});
  readonly motors = this.motorState.asReadonly();
  private readonly motorExpiry = new Map<number, ReturnType<typeof setTimeout>>();
  private jointIds: Readonly<Record<string, number>> = {};
  private readonly commandState = signal<Readonly<Record<number, { mode: number; value: number }>>>({});
  readonly commands = this.commandState.asReadonly();
  private readonly commandExpiry = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly trajectoryState = signal<Readonly<Record<string, number>>>({});
  private trajectoryExpiry: ReturnType<typeof setTimeout> | undefined;
  private readonly actualJointAnglesState = signal<Readonly<Record<string, number>> | null>(null);
  private readonly actualJointVelocitiesState = signal<Readonly<Record<string, number>> | null>(
    null,
  );

  readonly actualJointAngles = this.actualJointAnglesState.asReadonly();
  readonly actualJointVelocities = this.actualJointVelocitiesState.asReadonly();

  setFeedbackStatus(active: unknown, fresh: unknown): void {
    if (typeof active !== 'boolean' || typeof fresh !== 'boolean') return;
    this.feedbackStatusState.set(active && fresh);
    if (this.statusExpiry) clearTimeout(this.statusExpiry);
    this.statusExpiry = setTimeout(() => { this.feedbackStatusState.set(null); }, 2000);
  }

  setJointMapping(names: unknown, ids: unknown): void {
    if (!Array.isArray(names) || !Array.isArray(ids) || names.length !== ids.length) return;
    const mapping: Record<string, number> = {};
    names.forEach((name, index) => {
      if (typeof name === 'string' && typeof ids[index] === 'number') mapping[name] = ids[index];
    });
    this.jointIds = mapping;
  }

  commandFor(name: string): { mode: number; value: number } | undefined {
    const trajectory = this.trajectoryState()[name];
    if (trajectory !== undefined) return { mode: 1, value: trajectory * 180 / Math.PI };
    return this.commandState()[this.jointIds[name]];
  }

  setTrajectory(names: unknown, positions: unknown): void {
    if (!Array.isArray(names) || !Array.isArray(positions) || names.length !== positions.length) return;
    if (names.length === 0) {
      if (this.trajectoryExpiry) clearTimeout(this.trajectoryExpiry);
      this.trajectoryExpiry = undefined;
      this.trajectoryState.set({});
      return;
    }
    const values: Record<string, number> = {};
    names.forEach((name, index) => {
      const value = positions[index];
      if (typeof name === 'string' && typeof value === 'number' && Number.isFinite(value)) values[name] = value;
    });
    if (!Object.keys(values).length) return;
    this.trajectoryState.set(values);
    if (this.trajectoryExpiry) clearTimeout(this.trajectoryExpiry);
    this.trajectoryExpiry = setTimeout(() => { this.trajectoryState.set({}); this.trajectoryExpiry = undefined; }, 1500);
  }

  setCommand(id: unknown, mode: unknown, value: unknown): void {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 ||
        typeof mode !== 'number' || ![0, 1, 2].includes(mode) ||
        typeof value !== 'number' || !Number.isFinite(value)) return;
    const previous = this.commandExpiry.get(id);
    if (previous) clearTimeout(previous);
    if (mode === 0) {
      this.commandState.update((values) => { const next = { ...values }; delete next[id]; return next; });
      this.commandExpiry.delete(id);
      return;
    }
    this.commandState.update((values) => ({ ...values, [id]: { mode, value } }));
    this.commandExpiry.set(id, setTimeout(() => {
      this.commandState.update((values) => { const next = { ...values }; delete next[id]; return next; });
      this.commandExpiry.delete(id);
    }, 1500));
  }

  setMotorStatus(id: unknown, temperature: unknown, current: unknown): void {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 ||
        typeof temperature !== 'number' || !Number.isFinite(temperature) ||
        typeof current !== 'number' || !Number.isFinite(current)) return;
    this.motorState.update((values) => ({ ...values, [id]: { temperature, current } }));
    const previous = this.motorExpiry.get(id);
    if (previous) clearTimeout(previous);
    this.motorExpiry.set(id, setTimeout(() => {
      this.motorState.update((values) => {
        const next = { ...values };
        delete next[id];
        return next;
      });
      this.motorExpiry.delete(id);
    }, 2500));
  }

  /** Applies one valid JointState sample from the rover. */
  setJointState(state: ArmJointState): void {
    if (state.names.length !== state.positions.length || state.names.length === 0) return;

    const positions = Object.fromEntries(
      state.names
        .map((name, index) => [name, state.positions[index]] as const)
        .filter(([name, position]) => name && Number.isFinite(position)),
    );

    if (Object.keys(positions).length === 0) return;

    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = setTimeout(() => {
      this.actualJointAnglesState.set(null);
      this.actualJointVelocitiesState.set(null);
      this.expiry = undefined;
    }, 1000);

    this.actualJointAnglesState.set(positions);

    if (state.velocities && state.velocities.length === state.names.length) {
      const velocities: Record<string, number> = {};
      state.names.forEach((name, index) => {
        const velocity = state.velocities?.[index];
        if (name && velocity !== undefined && Number.isFinite(velocity)) {
          velocities[name] = velocity;
        }
      });

      this.actualJointVelocitiesState.set(velocities);
    } else {
      this.actualJointVelocitiesState.set(null);
    }
  }

  /** Clears feedback when the ROS connection is lost. */
  clear(): void {
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = undefined;
    if (this.statusExpiry) clearTimeout(this.statusExpiry);
    this.statusExpiry = undefined;
    this.feedbackStatusState.set(null);
    for (const timer of this.motorExpiry.values()) clearTimeout(timer);
    this.motorExpiry.clear();
    this.motorState.set({});
    for (const timer of this.commandExpiry.values()) clearTimeout(timer);
    this.commandExpiry.clear();
    this.commandState.set({});
    if (this.trajectoryExpiry) clearTimeout(this.trajectoryExpiry);
    this.trajectoryExpiry = undefined;
    this.trajectoryState.set({});
    this.jointIds = {};
    this.actualJointAnglesState.set(null);
    this.actualJointVelocitiesState.set(null);
  }

  ngOnDestroy(): void { this.clear(); }
}
