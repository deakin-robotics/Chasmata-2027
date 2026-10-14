import { Service, effect, inject } from '@angular/core';
import { Topic } from 'roslib';

import { ArmTelemetryService } from '../arm/telemetry/arm-telemetry.service';
import { ArmJointState } from '../arm/ik/arm-ik-types';
import { ArmOverrideCommand, ArmOverrideState } from '../control/arm/arm-override';
import {
  ArmMode,
  DriveMode,
  FmaStateService,
  LawMode,
  SystemMode,
  GimbalPriorityOwner,
} from '../fma/fma-state.service';
import { RosConnection } from './ros-connection';
import { RosHeartbeatMonitor } from './ros-heartbeat-monitor';

const FMA_STATE_TOPIC = '/fma/state';
const JOINT_STATE_TOPIC = '/arm/joint_states';
const FMA_STATE_MESSAGE_TYPE = 'telemetry_interfaces/msg/FmaState';
const JOINT_STATE_MESSAGE_TYPE = 'sensor_msgs/JointState';

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
  schema?: unknown;
  sequence?: unknown;
  drive?: FmaModeState;
  arm?: FmaModeState;
  law?: unknown;
  arm_override?: { state?: unknown; pending?: unknown };
  system?: unknown;
  gimbal_priority?: FmaModeState;
}

/** Adapts ROS telemetry messages into the GUI's shared state services. */
@Service()
export class RosTelemetryBridge {
  private readonly rosConnection = inject(RosConnection);
  private readonly heartbeatMonitor = inject(RosHeartbeatMonitor);
  private readonly fmaState = inject(FmaStateService);
  private readonly armTelemetry = inject(ArmTelemetryService);

  private roverFmaTopic: Topic | null = null;
  private jointStateTopic: Topic | null = null;

  private readonly roverTelemetryEffect = effect((onCleanup) => {
    const client = this.rosConnection.client();
    const roverAvailable = this.heartbeatMonitor.roverAvailable();

    if (!client || !roverAvailable) {
      this.armTelemetry.clear();
      return;
    }

    const fmaTopic = new Topic({
      ros: client,
      name: FMA_STATE_TOPIC,
      messageType: FMA_STATE_MESSAGE_TYPE,
    });
    const jointStateTopic = new Topic({
      ros: client,
      name: JOINT_STATE_TOPIC,
      messageType: JOINT_STATE_MESSAGE_TYPE,
    });
    this.roverFmaTopic = fmaTopic;
    this.jointStateTopic = jointStateTopic;

    fmaTopic.subscribe((message) => {
      if (
        this.rosConnection.client() !== client ||
        this.roverFmaTopic !== fmaTopic ||
        !this.heartbeatMonitor.roverAvailable()
      )
        return;

      this.handleFmaMessage(message);
    });
    jointStateTopic.subscribe((message) => {
      if (
        this.rosConnection.client() !== client ||
        this.jointStateTopic !== jointStateTopic ||
        !this.heartbeatMonitor.roverAvailable()
      )
        return;

      this.handleJointStateMessage(message as JointStateMessage);
    });

    onCleanup(() => {
      fmaTopic.unsubscribe();
      jointStateTopic.unsubscribe();
      if (this.roverFmaTopic === fmaTopic) this.roverFmaTopic = null;
      if (this.jointStateTopic === jointStateTopic) this.jointStateTopic = null;
      this.armTelemetry.clear();
      this.fmaState.resetControlModes();
    });
  });

  private handleFmaMessage(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const telemetry = message as FmaTelemetryMessage;

    this.applyModeTelemetry(telemetry.drive, 'drive');
    this.applyModeTelemetry(telemetry.arm, 'arm');

    const system = this.enumValue(telemetry.system, Object.values(SystemMode));

    this.applyLawTelemetry(telemetry.law);
    this.applyArmOverrideTelemetry(telemetry.arm_override);
    if (system !== undefined) this.fmaState.setSystemMode(system);
    this.applyGimbalPriorityTelemetry(telemetry.gimbal_priority);
    this.fmaState.markFmaTelemetryReceived();
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

  private applyLawTelemetry(value: FmaTelemetryMessage['law']): void {
    const law = this.enumValue(value, Object.values(LawMode));
    if (law !== undefined) this.fmaState.setLawTelemetry(law);
  }

  private applyArmOverrideTelemetry(value: FmaTelemetryMessage['arm_override']): void {
    if (!value || typeof value !== 'object') return;

    const overrideState = this.enumValue(value.state, Object.values(ArmOverrideState));
    const pending = this.enumValue(value.pending, Object.values(ArmOverrideCommand));

    if (overrideState !== undefined || pending !== undefined) {
      this.fmaState.setArmOverrideTelemetry(
        overrideState === undefined ? null : overrideState,
        pending === undefined ? null : pending,
      );
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
    if (value === null || value === '') return null;
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
    if (value === null || value === '' || value === 'UNKNOWN') return null;
    return value === 'DRIVER' || value === 'ARM OPS' ? value : undefined;
  }
}
