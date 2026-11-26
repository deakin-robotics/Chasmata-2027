import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Ros, Topic } from 'roslib';

import { ArmTelemetryService } from '../arm/telemetry/arm-telemetry.service';
import { DriveTelemetryService } from '../drive/drive-telemetry.service';
import { ArmOverrideCommand, ArmOverrideState } from '../control/arm/arm-override';
import { ArmMode, DriveMode, FmaColumn, FmaStateService, LawMode } from '../fma/fma-state.service';
import { RosConnection } from './ros-connection';
import { RosHeartbeatMonitor } from './ros-heartbeat-monitor';
import { RosTelemetryBridge } from './ros-telemetry-bridge';
import { BaseStationConnection } from './base-station-connection';

describe('RosTelemetryBridge', () => {
  afterEach(() => vi.restoreAllMocks());

  it('receives planner telemetry over the BaseStation link without rendering failures as SD telemetry', () => {
    const baseClient = {} as Ros;
    const baseClientState = signal<Ros | null>(baseClient);
    const baseAvailable = signal(true);
    let callback: ((message: unknown) => void) | undefined;
    vi.spyOn(Topic.prototype, 'subscribe').mockImplementation(function (this: Topic, handler) {
      if (this.name === '/arm/moveit/status') callback = handler as (message: unknown) => void;
    });
    vi.spyOn(Topic.prototype, 'unsubscribe').mockImplementation(() => {});
    TestBed.configureTestingModule({ providers: [
      { provide: RosConnection, useValue: { client: signal(null).asReadonly() } },
      { provide: BaseStationConnection, useValue: { client: baseClientState.asReadonly() } },
      { provide: RosHeartbeatMonitor, useValue: { roverAvailable: signal(false).asReadonly(), baseStationAvailable: baseAvailable.asReadonly() } },
    ] });
    TestBed.inject(RosTelemetryBridge);
    TestBed.flushEffects();
    const arm = TestBed.inject(ArmTelemetryService);
    expect(callback).toBeDefined();
    callback!({ state: 'PLANNING' });
    expect(arm.planner()).toBe('PLANNING');
    callback!({ state: 'FAILED' });
    expect(arm.planner()).toBeNull();
    baseAvailable.set(false);
    TestBed.flushEffects();
    expect(arm.planner()).toBeNull();
  });

  it('keeps LAW and Arm Override telemetry independent', () => {
    const connected = signal(false);
    const client = signal(null);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: RosConnection,
          useValue: {
            client: client.asReadonly(),
          },
        },
        {
          provide: RosHeartbeatMonitor,
          useValue: { roverAvailable: connected.asReadonly() },
        },
        ArmTelemetryService,
      ],
    });

    const bridge = TestBed.inject(RosTelemetryBridge);
    const fmaState = TestBed.inject(FmaStateService);
    const handleFmaMessage = (
      bridge as unknown as {
        handleFmaMessage(message: unknown): void;
      }
    ).handleFmaMessage.bind(bridge);

    handleFmaMessage(
      {
        schema: 'dcr/fma-state/v1',
        sequence: 1,
        drive: { confirmed: 'VELOCITY', pending: '', rejected: '' },
        arm: { confirmed: 'POSITION', pending: '', rejected: '' },
        law: 'DIRECT',
        arm_override: { state: 'INACTIVE', pending: 'ENABLE' },
        system: 'GOOD',
        gimbal_priority: { confirmed: 'DRIVER', pending: '', rejected: '' },
      },
    );

    expect(fmaState.columns()).toEqual(
      expect.arrayContaining([
        { label: 'DRIVE', confirmed: DriveMode.Velocity, commanded: null },
        { label: 'ARM', confirmed: ArmMode.Position, commanded: null },
        { label: 'LAW', confirmed: LawMode.Direct },
        { label: 'GIMBAL', confirmed: 'DRIVER', commanded: null },
      ]),
    );
    expect(fmaState.armOverrideState()).toBe(ArmOverrideState.Inactive);
    expect(fmaState.armOverridePending()).toBe(true);
    expect(fmaState.armOverrideActive()).toBe(false);

    handleFmaMessage(
      {
        schema: 'dcr/fma-state/v1',
        sequence: 2,
        drive: { confirmed: 'VELOCITY', pending: '', rejected: '' },
        arm: { confirmed: 'POSITION', pending: '', rejected: '' },
        law: 'DIRECT',
        arm_override: { state: 'ACTIVE', pending: 'DISABLE' },
        system: 'GOOD',
        gimbal_priority: { confirmed: 'DRIVER', pending: '', rejected: '' },
      },
    );

    expect(fmaState.columns()).toEqual(
      expect.arrayContaining([{ label: 'LAW', confirmed: LawMode.Direct }]),
    );
    expect(fmaState.armOverrideState()).toBe(ArmOverrideState.Active);
    expect(fmaState.armOverridePendingCommand()).toBe(ArmOverrideCommand.Disable);
    expect(fmaState.armOverrideActive()).toBe(true);
    expect(fmaState.armOverridePending()).toBe(false);
  });

  it('subscribes to FMA and joint states directly from Rover and clears FMA on heartbeat loss', () => {
    const roverClient = {} as Ros;
    const roverClientState = signal<Ros | null>(null);
    const roverAvailable = signal(false);
    const subscriptions: Array<{ topic: Topic; callback: (message: unknown) => void }> = [];

    vi.spyOn(Topic.prototype, 'subscribe').mockImplementation(function (this: Topic, callback) {
      subscriptions.push({ topic: this, callback: callback as (message: unknown) => void });
    });
    vi.spyOn(Topic.prototype, 'unsubscribe').mockImplementation(() => {});

    TestBed.configureTestingModule({
      providers: [
        {
          provide: RosConnection,
          useValue: { client: roverClientState.asReadonly() },
        },
        {
          provide: RosHeartbeatMonitor,
          useValue: { roverAvailable: roverAvailable.asReadonly() },
        },
        ArmTelemetryService,
      ],
    });

    TestBed.inject(RosTelemetryBridge);
    const fmaState = TestBed.inject(FmaStateService);
    const armTelemetry = TestBed.inject(ArmTelemetryService);
    const driveTelemetry = TestBed.inject(DriveTelemetryService);

    roverClientState.set(roverClient);
    roverAvailable.set(true);
    TestBed.flushEffects();

    const roverFma = subscriptions.find(
      ({ topic }) => topic.ros === roverClient && topic.name === '/fma/state',
    )!;
    const roverJointStates = subscriptions.find(
      ({ topic }) => topic.ros === roverClient && topic.name === '/telemetry/arm/joint_states',
    )!;

    roverFma.callback(fmaMessage(DriveMode.Velocity));
    expect(getDriveMode(fmaState)).toBe(DriveMode.Velocity);
    expect(fmaState.hasFmaTelemetry()).toBe(true);
    expect(subscriptions).toHaveLength(14);
    expect(subscriptions.every(({ topic }) => topic.ros === roverClient)).toBe(true);

    const recovery = subscriptions.find(({ topic }) => topic.name === '/telemetry/recovery_snapshot')!;
    recovery.callback({
      fma_valid: true, fma: fmaMessage(DriveMode.Manual),
      arm_joint_valid: true, arm_joints: { name: ['base_joint'], position: [0.1] },
      arm_status_valid: true, arm_status: { hardware_active: true, feedback_fresh: true, joint_names: ['base_joint'], joint_can_ids: [1] },
      arm_motors: [{ id: 1, temperature: 35, current: 1, speed: 2, angle: 30 }],
      arm_motor_details: [{ id: 1, bus_voltage: 24, bus_current: 2, mode: 'Speed Control' }],
      arm_trajectory_valid: true, arm_trajectory: { name: ['base_joint'], position: [0.4] },
      drive_joint_valid: true, drive_joints: { name: ['front_left_wheel_joint'], velocity: [1.5] },
      drive_temperature_valid: [true, false, false, false], drive_temperature_raw: [32, 0, 0, 0],
      drive_current_valid: [true, false, false, false], drive_current_raw: [12, 0, 0, 0],
      drive_odometry_valid: true, drive_odometry: { pose: { pose: { position: { x: 2 } } }, twist: { twist: { linear: { x: 0.5 } } } },
    });
    expect(getDriveMode(fmaState)).toBe(DriveMode.Velocity);
    expect(armTelemetry.actualJointAngles()).toEqual({ base_joint: 0.1 });
    expect(armTelemetry.motors()[1].angle).toBe(30);
    expect(armTelemetry.motorDetails()[1].busVoltage).toBe(24);
    expect(armTelemetry.commandFor('base_joint')?.value).toBeCloseTo(0.4 * 180 / Math.PI);
    expect(driveTelemetry.wheelVelocities()?.['front_left_wheel_joint']).toBe(1.5);
    expect(driveTelemetry.rawTemperatures()[0]).toBe(32);
    expect(driveTelemetry.rawCurrents()[0]).toBe(12);
    expect(driveTelemetry.odometry()).toEqual({ x: 2, speed: 0.5 });

    roverJointStates.callback({
      name: ['base_joint'],
      position: [0.25],
      velocity: [0.5],
    });
    expect(armTelemetry.actualJointAngles()).toEqual({ base_joint: 0.25 });

    roverAvailable.set(false);
    TestBed.flushEffects();
    expect(fmaState.hasFmaTelemetry()).toBe(false);
    expect(getDriveMode(fmaState)).toBeNull();

    roverFma.callback(fmaMessage(DriveMode.Manual));
    expect(fmaState.hasFmaTelemetry()).toBe(false);

    roverAvailable.set(true);
    TestBed.flushEffects();
    const recoveredRoverFma = subscriptions
      .filter(({ topic }) => topic.ros === roverClient && topic.name === '/fma/state')
      .at(-1)!;
    recoveredRoverFma.callback(fmaMessage(DriveMode.Manual));
    expect(fmaState.hasFmaTelemetry()).toBe(true);
    expect(getDriveMode(fmaState)).toBe(DriveMode.Manual);
  });
});

function fmaMessage(drive: DriveMode): unknown {
  return {
    drive: { confirmed: drive, pending: '' },
    arm: { confirmed: ArmMode.Manual, pending: '' },
    system: 'GOOD',
  };
}

function getDriveMode(state: FmaStateService): DriveMode | null {
  const column = state
    .columns()
    .find(
      (candidate): candidate is Extract<FmaColumn, { label: 'DRIVE' }> =>
        candidate.label === 'DRIVE',
    );
  return column?.confirmed ?? null;
}
