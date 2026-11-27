import { Service, effect, inject } from '@angular/core';
import { Topic } from 'roslib';

import { ArmTelemetryService } from '../arm/telemetry/arm-telemetry.service';
import { DriveTelemetryService } from '../drive/drive-telemetry.service';
import { DriveViewService } from '../drive/drive-view.service';
import { BaseStationConnection } from './base-station-connection';
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
const JOINT_STATE_TOPIC = '/telemetry/arm/joint_states';
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
  private readonly driveTelemetry = inject(DriveTelemetryService);
  private readonly driveView = inject(DriveViewService);
  private readonly baseStation = inject(BaseStationConnection);

  private roverFmaTopic: Topic | null = null;
  private jointStateTopic: Topic | null = null;
  private driveTelemetryTopic: Topic | null = null;
  private driveCommandTopic: Topic | null = null;
  private driveTemperatureTopic: Topic | null = null;
  private driveCurrentTopic: Topic | null = null;
  private driveOdometryTopic: Topic | null = null;
  private driveLinearCommandTopic: Topic | null = null;
  private armStatusTopic: Topic | null = null;
  private armMotorTopic: Topic | null = null;
  private armMotorDetailTopic: Topic | null = null;
  private armCommandTopic: Topic | null = null;
  private armTrajectoryTopic: Topic | null = null;
  private recoveryTopic: Topic | null = null;
  private plannerTopic: Topic | null = null;

  private readonly plannerEffect = effect((onCleanup) => {
    const client = this.baseStation.client();
    if (!client || !this.heartbeatMonitor.baseStationAvailable()) { this.armTelemetry.clearPlanner(); return; }
    const topic = new Topic({ ros: client, name: '/arm/moveit/status', messageType: 'telemetry_interfaces/msg/ArmMoveItStatus' });
    this.plannerTopic = topic;
    topic.subscribe((message) => {
      if (this.baseStation.client() !== client || this.plannerTopic !== topic || !this.heartbeatMonitor.baseStationAvailable()) return;
      this.armTelemetry.setPlanner((message as { state?: unknown }).state);
    });
    onCleanup(() => { topic.unsubscribe(); if (this.plannerTopic === topic) this.plannerTopic = null; this.armTelemetry.clearPlanner(); });
  });

  private readonly roverTelemetryEffect = effect((onCleanup) => {
    const client = this.rosConnection.client();
    const roverAvailable = this.heartbeatMonitor.roverAvailable();

    if (!client || !roverAvailable) {
      this.armTelemetry.clear();
      this.driveTelemetry.clear();
      return;
    }
    const liveReceived = new Set<string>();
    const driveLiveTimes = new Map<string, number>();
    const markDriveLive = (key: string) => { liveReceived.add(key); driveLiveTimes.set(key, Date.now()); };

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
    const driveTelemetryTopic = new Topic({
      ros: client,
      name: '/telemetry/drive/live/joint_states',
      messageType: JOINT_STATE_MESSAGE_TYPE,
    });
    const armStatusTopic = new Topic({
      ros: client,
      name: '/telemetry/arm/status',
      messageType: 'telemetry_interfaces/msg/ArmControlStatus',
    });
    this.armStatusTopic = armStatusTopic;
    armStatusTopic.subscribe((message) => {
      if (this.rosConnection.client() !== client || this.armStatusTopic !== armStatusTopic || !this.heartbeatMonitor.roverAvailable()) return;
      liveReceived.add('arm_status');
      const status = message as { hardware_active?: unknown; feedback_fresh?: unknown; joint_names?: unknown; joint_can_ids?: unknown };
      this.armTelemetry.setFeedbackStatus(status.hardware_active, status.feedback_fresh);
      this.armTelemetry.setJointMapping(status.joint_names, status.joint_can_ids);
    });
    const armMotorTopic = new Topic({
      ros: client, name: '/telemetry/arm/motor_status', messageType: 'arm_interfaces/msg/MotorStat1',
    });
    this.armMotorTopic = armMotorTopic;
    armMotorTopic.subscribe((message) => {
      if (this.rosConnection.client() !== client || this.armMotorTopic !== armMotorTopic || !this.heartbeatMonitor.roverAvailable()) return;
      const motor = message as { id?: unknown; temp?: unknown; current?: unknown; speed?: unknown; angle?: unknown };
      if (typeof motor.id === 'number') liveReceived.add(`arm_motor:${motor.id}`);
      this.armTelemetry.setMotorStatus(motor.id, motor.temp, motor.current, motor.speed, motor.angle);
    });
    const armMotorDetailTopic = new Topic({ ros: client, name: '/telemetry/arm/motor_detail', messageType: 'arm_interfaces/msg/MotorStat2' });
    this.armMotorDetailTopic = armMotorDetailTopic;
    armMotorDetailTopic.subscribe((message) => {
      if (this.rosConnection.client() !== client || this.armMotorDetailTopic !== armMotorDetailTopic || !this.heartbeatMonitor.roverAvailable()) return;
      const motor = message as { id?: unknown; busv?: unknown; busc?: unknown; mode?: unknown };
      if (typeof motor.id === 'number') liveReceived.add(`arm_motor_detail:${motor.id}`);
      this.armTelemetry.setMotorDetail(motor.id, motor.busv, motor.busc, motor.mode);
    });
    const armCommandTopic = new Topic({ ros: client, name: '/telemetry/arm/commands', messageType: 'dcr_arm_driver/msg/DirectDrive' });
    this.armCommandTopic = armCommandTopic;
    armCommandTopic.subscribe((message) => {
      if (this.rosConnection.client() !== client || this.armCommandTopic !== armCommandTopic || !this.heartbeatMonitor.roverAvailable()) return;
      const command = message as { id?: unknown; mode?: unknown; value?: unknown };
      if (typeof command.id === 'number') liveReceived.add(`arm_command:${command.id}`);
      this.armTelemetry.setCommand(command.id, command.mode, command.value);
    });
    const armTrajectoryTopic = new Topic({ ros: client, name: '/telemetry/arm/trajectory_commands', messageType: JOINT_STATE_MESSAGE_TYPE });
    this.armTrajectoryTopic = armTrajectoryTopic;
    armTrajectoryTopic.subscribe((message) => {
      if (this.rosConnection.client() !== client || this.armTrajectoryTopic !== armTrajectoryTopic || !this.heartbeatMonitor.roverAvailable()) return;
      liveReceived.add('arm_trajectory');
      const command = message as JointStateMessage;
      this.armTelemetry.setTrajectory(command.name, command.position);
    });
    const recoveryTopic = new Topic({ ros: client, name: '/telemetry/recovery_snapshot', messageType: 'telemetry_interfaces/msg/RecoverySnapshot' });
    this.recoveryTopic = recoveryTopic;
    let recovered = false;
    recoveryTopic.subscribe((message) => {
      if (this.rosConnection.client() !== client || this.recoveryTopic !== recoveryTopic || !this.heartbeatMonitor.roverAvailable()) return;
      const preferred = new Set(liveReceived);
      if (message && typeof message === 'object') {
        const snapshot = message as { drive_joint_age_ms?: number; drive_command_age_ms?: number; drive_odometry_age_ms?: number; drive_linear_command_age_ms?: number; drive_temperature_age_ms?: number[]; drive_current_age_ms?: number[] };
        const protect = (key: string, age: unknown) => {
          const received = driveLiveTimes.get(key);
          if (received !== undefined && typeof age === 'number' && Number.isFinite(age) && Date.now() - received < age) preferred.add(key);
        };
        protect('drive_joints', snapshot.drive_joint_age_ms);
        protect('drive_commands', snapshot.drive_command_age_ms);
        protect('drive_odometry', snapshot.drive_odometry_age_ms);
        protect('drive_linear_command', snapshot.drive_linear_command_age_ms);
        for (let wheel = 0; wheel < 4; ++wheel) {
          protect(`drive_temperature:${wheel}`, snapshot.drive_temperature_age_ms?.[wheel]);
          protect(`drive_current:${wheel}`, snapshot.drive_current_age_ms?.[wheel]);
        }
      }
      this.applyRecoverySnapshot(message, preferred, recovered);
      recovered = true;
      for (const key of liveReceived) if (key.startsWith('drive_')) liveReceived.delete(key);
    });
    this.driveTelemetryTopic = driveTelemetryTopic;
    driveTelemetryTopic.subscribe((message) => {
      if (!this.driveView.active()) return;
      if (this.rosConnection.client() !== client || this.driveTelemetryTopic !== driveTelemetryTopic || !this.heartbeatMonitor.roverAvailable()) return;
      markDriveLive('drive_joints');
      const state = message as JointStateMessage;
      this.driveTelemetry.setJointState(state.name, state.velocity);
    });
    const driveCommandTopic = new Topic({ ros: client, name: '/telemetry/drive/live/commands', messageType: JOINT_STATE_MESSAGE_TYPE });
    this.driveCommandTopic = driveCommandTopic;
    driveCommandTopic.subscribe((message) => {
      if (!this.driveView.active()) return;
      if (this.rosConnection.client() !== client || this.driveCommandTopic !== driveCommandTopic || !this.heartbeatMonitor.roverAvailable()) return;
      markDriveLive('drive_commands');
      const command = message as JointStateMessage;
      this.driveTelemetry.setCommands(command.name, command.velocity);
    });
    const driveTemperatureTopic = new Topic({ ros: client, name: '/telemetry/drive/live/temperature_raw', messageType: 'std_msgs/msg/Int32MultiArray' });
    this.driveTemperatureTopic = driveTemperatureTopic;
    driveTemperatureTopic.subscribe((message) => {
      if (!this.driveView.active()) return;
      if (this.rosConnection.client() !== client || this.driveTemperatureTopic !== driveTemperatureTopic || !this.heartbeatMonitor.roverAvailable()) return;
      const data = (message as { data?: unknown }).data;
      if (Array.isArray(data) && typeof data[0] === 'number') markDriveLive(`drive_temperature:${data[0]}`);
      this.driveTelemetry.setTemperature(data);
    });
    const driveCurrentTopic = new Topic({ ros: client, name: '/telemetry/drive/live/current_raw', messageType: 'std_msgs/msg/Int32MultiArray' });
    this.driveCurrentTopic = driveCurrentTopic;
    driveCurrentTopic.subscribe((message) => {
      if (!this.driveView.active()) return;
      if (this.rosConnection.client() !== client || this.driveCurrentTopic !== driveCurrentTopic || !this.heartbeatMonitor.roverAvailable()) return;
      const data = (message as { data?: unknown }).data;
      if (Array.isArray(data) && typeof data[0] === 'number') markDriveLive(`drive_current:${data[0]}`);
      this.driveTelemetry.setCurrent(data);
    });
    const driveOdometryTopic = new Topic({ ros: client, name: '/telemetry/drive/live/odometry', messageType: 'nav_msgs/msg/Odometry' });
    this.driveOdometryTopic = driveOdometryTopic;
    driveOdometryTopic.subscribe((message) => {
      if (!this.driveView.active()) return;
      if (this.rosConnection.client() !== client || this.driveOdometryTopic !== driveOdometryTopic || !this.heartbeatMonitor.roverAvailable()) return;
      markDriveLive('drive_odometry');
      this.driveTelemetry.setOdometry(message);
    });
    const driveLinearCommandTopic = new Topic({ ros: client, name: '/telemetry/drive/live/linear_command', messageType: 'geometry_msgs/msg/TwistStamped' });
    this.driveLinearCommandTopic = driveLinearCommandTopic;
    driveLinearCommandTopic.subscribe((message) => {
      if (!this.driveView.active()) return;
      if (this.rosConnection.client() !== client || this.driveLinearCommandTopic !== driveLinearCommandTopic || !this.heartbeatMonitor.roverAvailable()) return;
      markDriveLive('drive_linear_command');
      this.driveTelemetry.setLinearCommand(message);
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

      liveReceived.add('fma');
      this.handleFmaMessage(message);
    });
    jointStateTopic.subscribe((message) => {
      if (
        this.rosConnection.client() !== client ||
        this.jointStateTopic !== jointStateTopic ||
        !this.heartbeatMonitor.roverAvailable()
      )
        return;

      liveReceived.add('arm_joints');
      this.handleJointStateMessage(message as JointStateMessage);
    });

    onCleanup(() => {
      fmaTopic.unsubscribe();
      jointStateTopic.unsubscribe();
      driveTelemetryTopic.unsubscribe();
      driveCommandTopic.unsubscribe();
      driveTemperatureTopic.unsubscribe();
      driveCurrentTopic.unsubscribe();
      driveOdometryTopic.unsubscribe();
      driveLinearCommandTopic.unsubscribe();
      armStatusTopic.unsubscribe();
      armMotorTopic.unsubscribe();
      armMotorDetailTopic.unsubscribe();
      armCommandTopic.unsubscribe();
      armTrajectoryTopic.unsubscribe();
      recoveryTopic.unsubscribe();
      if (this.roverFmaTopic === fmaTopic) this.roverFmaTopic = null;
      if (this.jointStateTopic === jointStateTopic) this.jointStateTopic = null;
      if (this.driveTelemetryTopic === driveTelemetryTopic) this.driveTelemetryTopic = null;
      if (this.driveCommandTopic === driveCommandTopic) this.driveCommandTopic = null;
      if (this.driveTemperatureTopic === driveTemperatureTopic) this.driveTemperatureTopic = null;
      if (this.driveCurrentTopic === driveCurrentTopic) this.driveCurrentTopic = null;
      if (this.driveOdometryTopic === driveOdometryTopic) this.driveOdometryTopic = null;
      if (this.driveLinearCommandTopic === driveLinearCommandTopic) this.driveLinearCommandTopic = null;
      if (this.armStatusTopic === armStatusTopic) this.armStatusTopic = null;
      if (this.armMotorTopic === armMotorTopic) this.armMotorTopic = null;
      if (this.armMotorDetailTopic === armMotorDetailTopic) this.armMotorDetailTopic = null;
      if (this.armCommandTopic === armCommandTopic) this.armCommandTopic = null;
      if (this.armTrajectoryTopic === armTrajectoryTopic) this.armTrajectoryTopic = null;
      if (this.recoveryTopic === recoveryTopic) this.recoveryTopic = null;
      this.armTelemetry.clear();
      this.driveTelemetry.clear();
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

  private applyRecoverySnapshot(message: unknown, live: ReadonlySet<string>, driveOnly = false): void {
    if (!message || typeof message !== 'object') return;
    const snapshot = message as {
      fma_valid?: unknown; fma?: unknown;
      arm_joint_valid?: unknown; arm_joints?: JointStateMessage;
      arm_status_valid?: unknown; arm_status?: { hardware_active?: unknown; feedback_fresh?: unknown; joint_names?: unknown; joint_can_ids?: unknown };
      arm_motors?: Array<{ id?: unknown; temperature?: unknown; current?: unknown; speed?: unknown; angle?: unknown }>;
      arm_motor_details?: Array<{ id?: unknown; bus_voltage?: unknown; bus_current?: unknown; mode?: unknown }>;
      arm_commands?: Array<{ id?: unknown; mode?: unknown; value?: unknown }>;
      arm_trajectory_valid?: unknown; arm_trajectory?: JointStateMessage;
      drive_joint_age_ms?: number; drive_command_age_ms?: number; drive_odometry_age_ms?: number; drive_linear_command_age_ms?: number;
      drive_temperature_age_ms?: number[]; drive_current_age_ms?: number[];
      drive_joint_valid?: unknown; drive_joints?: JointStateMessage;
      drive_command_valid?: unknown; drive_commands?: JointStateMessage;
      drive_temperature_valid?: unknown; drive_temperature_raw?: unknown;
      drive_current_valid?: unknown; drive_current_raw?: unknown;
      drive_odometry_valid?: unknown; drive_odometry?: unknown;
      drive_linear_command_valid?: unknown; drive_linear_command?: unknown;
    };
    if (!driveOnly && snapshot.fma_valid === true && !live.has('fma')) this.handleFmaMessage(snapshot.fma);
    if (!driveOnly && snapshot.arm_joint_valid === true && snapshot.arm_joints && !live.has('arm_joints')) this.handleJointStateMessage(snapshot.arm_joints);
    if (!driveOnly && snapshot.arm_status_valid === true && snapshot.arm_status && !live.has('arm_status')) {
      this.armTelemetry.setFeedbackStatus(snapshot.arm_status.hardware_active, snapshot.arm_status.feedback_fresh);
      this.armTelemetry.setJointMapping(snapshot.arm_status.joint_names, snapshot.arm_status.joint_can_ids);
    }
    if (!driveOnly && Array.isArray(snapshot.arm_motors)) {
      for (const motor of snapshot.arm_motors) if (!live.has(`arm_motor:${motor.id}`)) this.armTelemetry.setMotorStatus(motor.id, motor.temperature, motor.current, motor.speed, motor.angle);
    }
    if (!driveOnly && Array.isArray(snapshot.arm_motor_details)) {
      for (const motor of snapshot.arm_motor_details) if (!live.has(`arm_motor_detail:${motor.id}`)) this.armTelemetry.setMotorDetail(motor.id, motor.bus_voltage, motor.bus_current, motor.mode);
    }
    if (!driveOnly && Array.isArray(snapshot.arm_commands)) {
      for (const command of snapshot.arm_commands) if (!live.has(`arm_command:${command.id}`)) this.armTelemetry.setCommand(command.id, command.mode, command.value);
    }
    if (!driveOnly && snapshot.arm_trajectory_valid === true && snapshot.arm_trajectory && !live.has('arm_trajectory'))
      this.armTelemetry.setTrajectory(snapshot.arm_trajectory.name, snapshot.arm_trajectory.position);
    if (snapshot.drive_joint_valid === true && snapshot.drive_joints && !live.has('drive_joints'))
      this.driveTelemetry.setJointState(snapshot.drive_joints.name, snapshot.drive_joints.velocity, snapshot.drive_joint_age_ms);
    if (snapshot.drive_command_valid === true && snapshot.drive_commands && !live.has('drive_commands'))
      this.driveTelemetry.setCommands(snapshot.drive_commands.name, snapshot.drive_commands.velocity, snapshot.drive_command_age_ms);
    if (snapshot.drive_odometry_valid === true && !live.has('drive_odometry')) this.driveTelemetry.setOdometry(snapshot.drive_odometry, snapshot.drive_odometry_age_ms);
    if (snapshot.drive_linear_command_valid === true && !live.has('drive_linear_command')) this.driveTelemetry.setLinearCommand(snapshot.drive_linear_command, snapshot.drive_linear_command_age_ms);
    const rawTemperatures = snapshot.drive_temperature_raw;
    if (Array.isArray(snapshot.drive_temperature_valid) && Array.isArray(rawTemperatures)) {
      snapshot.drive_temperature_valid.forEach((valid, wheel) => {
        if (!live.has(`drive_temperature:${wheel}`)) this.driveTelemetry.setTemperature([wheel, valid === true ? rawTemperatures[wheel] : -1], snapshot.drive_temperature_age_ms?.[wheel]);
      });
    }
    const rawCurrents = snapshot.drive_current_raw;
    if (Array.isArray(snapshot.drive_current_valid) && Array.isArray(rawCurrents)) {
      snapshot.drive_current_valid.forEach((valid, wheel) => {
        if (!live.has(`drive_current:${wheel}`)) this.driveTelemetry.setCurrent([wheel, valid === true ? rawCurrents[wheel] : -1], snapshot.drive_current_age_ms?.[wheel]);
      });
    }
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
