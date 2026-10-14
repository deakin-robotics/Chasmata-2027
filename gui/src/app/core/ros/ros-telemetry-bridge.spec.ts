import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Ros, Topic } from 'roslib';

import { ArmTelemetryService } from '../arm/telemetry/arm-telemetry.service';
import { ArmOverrideCommand, ArmOverrideState } from '../control/arm/arm-override';
import { ArmMode, DriveMode, FmaColumn, FmaStateService, LawMode } from '../fma/fma-state.service';
import { BaseStationConnection } from './base-station-connection';
import { RosConnection } from './ros-connection';
import { RosHeartbeatMonitor } from './ros-heartbeat-monitor';
import { RosTelemetryBridge } from './ros-telemetry-bridge';

describe('RosTelemetryBridge', () => {
  afterEach(() => vi.restoreAllMocks());

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
        handleFmaMessage(message: unknown, source: 'ROVER' | 'BASESTATION'): void;
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
      'ROVER',
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
      'ROVER',
    );

    expect(fmaState.columns()).toEqual(
      expect.arrayContaining([{ label: 'LAW', confirmed: LawMode.Direct }]),
    );
    expect(fmaState.armOverrideState()).toBe(ArmOverrideState.Active);
    expect(fmaState.armOverridePendingCommand()).toBe(ArmOverrideCommand.Disable);
    expect(fmaState.armOverrideActive()).toBe(true);
    expect(fmaState.armOverridePending()).toBe(false);
    expect(fmaState.telemetrySource()).toBe('ROVER');
  });

  it('prefers BaseStation FMA, falls back to Rover, and keeps joint states on Rover', () => {
    const roverClient = {} as Ros;
    const baseStationClient = {} as Ros;
    const roverClientState = signal<Ros | null>(null);
    const baseStationClientState = signal<Ros | null>(null);
    const roverAvailable = signal(false);
    const baseStationConnected = signal(false);
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
          provide: BaseStationConnection,
          useValue: {
            client: baseStationClientState.asReadonly(),
            isConnected: baseStationConnected.asReadonly(),
          },
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

    baseStationClientState.set(baseStationClient);
    baseStationConnected.set(true);
    TestBed.flushEffects();
    expect(
      subscriptions.some(
        ({ topic }) => topic.ros === baseStationClient && topic.name === '/fma/state',
      ),
    ).toBe(false);
    expect(fmaState.hasFmaTelemetry()).toBe(false);

    roverClientState.set(roverClient);
    roverAvailable.set(true);
    TestBed.flushEffects();

    const roverFma = subscriptions.find(
      ({ topic }) => topic.ros === roverClient && topic.name === '/fma/state',
    )!;
    const roverJointStates = subscriptions.find(
      ({ topic }) => topic.ros === roverClient && topic.name === '/arm/joint_states',
    )!;

    roverFma.callback(fmaMessage(DriveMode.Velocity));
    expect(getDriveMode(fmaState)).toBe(DriveMode.Velocity);
    expect(fmaState.telemetrySource()).toBe('ROVER');

    const baseStationFma = subscriptions.find(
      ({ topic }) => topic.ros === baseStationClient && topic.name === '/fma/state',
    )!;
    expect(
      subscriptions.some(
        ({ topic }) => topic.ros === baseStationClient && topic.name === '/arm/joint_states',
      ),
    ).toBe(false);

    roverFma.callback(fmaMessage(DriveMode.Manual));
    expect(getDriveMode(fmaState)).toBe(DriveMode.Manual);
    baseStationFma.callback(fmaMessage(DriveMode.Velocity));
    expect(fmaState.telemetrySource()).toBe('BASESTATION');
    roverFma.callback(fmaMessage(DriveMode.Manual));
    expect(getDriveMode(fmaState)).toBe(DriveMode.Velocity);

    roverJointStates.callback({
      name: ['base_joint'],
      position: [0.25],
      velocity: [0.5],
    });
    expect(armTelemetry.actualJointAngles()).toEqual({ base_joint: 0.25 });

    baseStationConnected.set(false);
    baseStationClientState.set(null);
    TestBed.flushEffects();

    roverFma.callback(fmaMessage(DriveMode.Manual));
    expect(getDriveMode(fmaState)).toBe(DriveMode.Manual);
    expect(fmaState.telemetrySource()).toBe('ROVER');
    expect(fmaState.hasFmaTelemetry()).toBe(true);

    baseStationClientState.set(baseStationClient);
    baseStationConnected.set(true);
    TestBed.flushEffects();
    const reconnectedBaseStationFma = subscriptions
      .filter(({ topic }) => topic.ros === baseStationClient && topic.name === '/fma/state')
      .at(-1)!;
    reconnectedBaseStationFma.callback(fmaMessage(DriveMode.Velocity));

    roverAvailable.set(false);
    TestBed.flushEffects();
    expect(fmaState.hasFmaTelemetry()).toBe(false);
    expect(fmaState.telemetrySource()).toBeNull();
    expect(getDriveMode(fmaState)).toBeNull();

    reconnectedBaseStationFma.callback(fmaMessage(DriveMode.Velocity));
    expect(fmaState.hasFmaTelemetry()).toBe(false);

    roverAvailable.set(true);
    TestBed.flushEffects();
    const recoveredBaseStationFma = subscriptions
      .filter(({ topic }) => topic.ros === baseStationClient && topic.name === '/fma/state')
      .at(-1)!;
    recoveredBaseStationFma.callback(fmaMessage(DriveMode.Velocity));
    expect(fmaState.hasFmaTelemetry()).toBe(true);
    expect(fmaState.telemetrySource()).toBe('BASESTATION');
    expect(getDriveMode(fmaState)).toBe(DriveMode.Velocity);

    baseStationConnected.set(false);
    baseStationClientState.set(null);
    TestBed.flushEffects();

    const recoveredRoverFma = subscriptions
      .filter(({ topic }) => topic.ros === roverClient && topic.name === '/fma/state')
      .at(-1)!;
    recoveredRoverFma.callback(fmaMessage(DriveMode.Manual));
    expect(fmaState.hasFmaTelemetry()).toBe(true);
    expect(fmaState.telemetrySource()).toBe('ROVER');
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
