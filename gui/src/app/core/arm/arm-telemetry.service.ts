import { Service, signal } from '@angular/core';

import { ArmJointState } from './arm-ik-types';

/** Stores authoritative arm feedback received from the rover. */
@Service()
export class ArmTelemetryService {
  private readonly actualJointAnglesState = signal<Readonly<Record<string, number>> | null>(null);
  private readonly actualJointVelocitiesState = signal<Readonly<Record<string, number>> | null>(
    null,
  );

  readonly actualJointAngles = this.actualJointAnglesState.asReadonly();
  readonly actualJointVelocities = this.actualJointVelocitiesState.asReadonly();

  /** Applies one valid JointState sample from the rover. */
  setJointState(state: ArmJointState): void {
    if (state.names.length !== state.positions.length || state.names.length === 0) return;

    const positions = Object.fromEntries(
      state.names
        .map((name, index) => [name, state.positions[index]] as const)
        .filter(([name, position]) => name && Number.isFinite(position)),
    );

    if (Object.keys(positions).length === 0) return;

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
    }
  }

  /** Clears feedback when the ROS connection is lost. */
  clear(): void {
    this.actualJointAnglesState.set(null);
    this.actualJointVelocitiesState.set(null);
  }
}
