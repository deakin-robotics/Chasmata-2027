import { Service, effect, inject, untracked } from '@angular/core';
import { Ros, Topic } from 'roslib';

import { ArmTelemetryService } from '../arm/arm-telemetry.service';
import { ArmJointState } from '../arm/arm-ik-types';
import {
  ArmMode,
  DriveMode,
  FmaStateService,
  LawRequest,
  LawMode,
  SystemMode,
  GimbalPriorityOwner,
} from '../fma/fma-state.service';
import { RosConnection } from './ros-connection';

const FMA_STATE_TOPIC = '/fma/state';
const JOINT_STATE_TOPIC = '/joint_states';
const STRING_MESSAGE_TYPE = 'std_msgs/String';
const JOINT_STATE_MESSAGE_TYPE = 'sensor_msgs/JointState';

interface StringMessage {
  data?: unknown;
}

interface JointStateMessage {
  name?: unknown;
  position?: unknown;
  velocity?: unknown;
}

interface FmaModeState {
  confirmed?: unknown;
  pending?: unknown;
  rejected?: unknown;
}

interface FmaTelemetryMessage {
  drive?: FmaModeState;
  arm?: FmaModeState;
  law?: unknown;
  system?: unknown;
  gimbal_priority?: unknown;
}

/** Adapts ROS telemetry messages into the GUI's shared state services. */
@Service()
export class RosTelemetryBridge {
  private readonly rosConnection = inject(RosConnection);
  private readonly fmaState = inject(FmaStateService);
  private readonly armTelemetry = inject(ArmTelemetryService);

  private activeClient: Ros | null = null;
  private fmaTopic: Topic | null = null;
  private jointStateTopic: Topic | null = null;

  private readonly connectionEffect = effect(() => {
    const client = this.rosConnection.client();
    const connected = this.rosConnection.isConnected();

    untracked(() => this.updateSubscriptions(connected ? client : null));
  });

  private updateSubscriptions(client: Ros | null): void {
    if (client === this.activeClient) return;

    this.disposeSubscriptions();
    if (!client) {
      this.armTelemetry.clear();
      return;
    }

    this.activeClient = client;
    this.fmaTopic = new Topic({
      ros: client,
      name: FMA_STATE_TOPIC,
      messageType: STRING_MESSAGE_TYPE,
    });
    this.jointStateTopic = new Topic({
      ros: client,
      name: JOINT_STATE_TOPIC,
      messageType: JOINT_STATE_MESSAGE_TYPE,
    });

    this.fmaTopic.subscribe((message) => this.handleFmaMessage(message as StringMessage));
    this.jointStateTopic.subscribe((message) =>
      this.handleJointStateMessage(message as JointStateMessage),
    );
  }

  private handleFmaMessage(message: StringMessage): void {
    if (typeof message.data !== 'string') return;

    let telemetry: FmaTelemetryMessage;
    try {
      telemetry = JSON.parse(message.data) as FmaTelemetryMessage;
    } catch {
      return;
    }

    this.applyModeTelemetry(telemetry.drive, 'drive');
    this.applyModeTelemetry(telemetry.arm, 'arm');

    const system = this.enumValue(telemetry.system, Object.values(SystemMode));

    this.applyLawTelemetry(telemetry.law);
    if (system !== undefined) this.fmaState.setSystemMode(system);
    this.applyGimbalPriorityTelemetry(telemetry.gimbal_priority);
  }

  private applyModeTelemetry(state: FmaModeState | undefined, subsystem: 'drive' | 'arm'): void {
    if (!state) return;

    if (subsystem === 'drive') {
      const confirmed = this.enumValue(state.confirmed, Object.values(DriveMode));
      const pending = this.enumValue(state.pending, Object.values(DriveMode));
      if (confirmed !== undefined && pending !== undefined) {
        this.fmaState.setDriveTelemetry(confirmed, pending);
      } else if (confirmed !== undefined) {
        this.fmaState.setDriveTelemetry(confirmed, null);
      } else if (pending !== undefined) {
        this.fmaState.setDriveTelemetry(null, pending);
      }

      return;
    }

    const confirmed = this.enumValue(state.confirmed, Object.values(ArmMode));
    const pending = this.enumValue(state.pending, Object.values(ArmMode));
    if (confirmed !== undefined && pending !== undefined) {
      this.fmaState.setArmTelemetry(confirmed, pending);
    } else if (confirmed !== undefined) {
      this.fmaState.setArmTelemetry(confirmed, null);
    } else if (pending !== undefined) {
      this.fmaState.setArmTelemetry(null, pending);
    }
  }

  private applyLawTelemetry(value: unknown): void {
    if (value === null || typeof value === 'string') {
      const confirmed = this.enumValue(value, Object.values(LawMode));
      if (confirmed !== undefined) this.fmaState.setLawMode(confirmed);
      return;
    }

    if (!value || typeof value !== 'object') return;

    const state = value as FmaModeState;
    const confirmed = this.enumValue(state.confirmed, Object.values(LawMode));
    const pending = this.enumValue(state.pending, Object.values(LawRequest));

    if (confirmed !== undefined && pending !== undefined) {
      this.fmaState.setLawTelemetry(confirmed, pending);
    } else if (confirmed !== undefined) {
      this.fmaState.setLawTelemetry(confirmed, null);
    } else if (pending !== undefined) {
      this.fmaState.setLawTelemetry(null, pending);
    }
  }

  private handleJointStateMessage(message: JointStateMessage): void {
    if (!Array.isArray(message.name) || !Array.isArray(message.position)) return;

    const names = message.name.filter((name): name is string => typeof name === 'string');
    const positions = message.position.filter(
      (position): position is number => typeof position === 'number' && Number.isFinite(position),
    );
    const rawVelocities = Array.isArray(message.velocity) ? message.velocity : undefined;
    const velocities = rawVelocities
      ? rawVelocities.filter(
          (velocity): velocity is number =>
            typeof velocity === 'number' && Number.isFinite(velocity),
        )
      : undefined;

    if (names.length !== message.name.length || positions.length !== message.position.length)
      return;
    if (velocities && rawVelocities && velocities.length !== rawVelocities.length) return;

    const state: ArmJointState = { names, positions, velocities };
    this.armTelemetry.setJointState(state);
  }

  private enumValue<T extends string>(value: unknown, values: readonly T[]): T | null | undefined {
    if (value === null) return null;
    return typeof value === 'string' && values.includes(value as T) ? (value as T) : undefined;
  }

  private applyGimbalPriorityTelemetry(value: unknown): void {
    if (value === null || typeof value === 'string') {
      const confirmed = this.parseGimbalPriorityOwner(value);
      if (confirmed !== undefined) this.fmaState.setGimbalPriorityOwner(confirmed);
      return;
    }

    if (!value || typeof value !== 'object') return;

    const state = value as FmaModeState;
    const confirmed = this.parseGimbalPriorityOwner(state.confirmed);
    const pending = this.parseGimbalPriorityOwner(state.pending);

    if (confirmed !== undefined && pending !== undefined) {
      this.fmaState.setGimbalPriorityTelemetry(confirmed, pending);
    } else if (confirmed !== undefined) {
      this.fmaState.setGimbalPriorityTelemetry(confirmed, null);
    } else if (pending !== undefined) {
      this.fmaState.setGimbalPriorityTelemetry(null, pending);
    }
  }

  private parseGimbalPriorityOwner(value: unknown): GimbalPriorityOwner | null | undefined {
    if (value === null || value === 'UNKNOWN') return null;
    return value === 'DRIVER' || value === 'ARM OPS' ? value : undefined;
  }

  private disposeSubscriptions(): void {
    this.fmaTopic?.unsubscribe();
    this.jointStateTopic?.unsubscribe();
    this.fmaTopic = null;
    this.jointStateTopic = null;
    this.activeClient = null;
  }
}
