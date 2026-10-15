import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Ros, Topic } from 'roslib';

import { BaseStationConnection } from '../ros/base-station-connection';
import { RosConnection } from '../ros/ros-connection';
import { RosHeartbeatMonitor } from '../ros/ros-heartbeat-monitor';
import { EcamAlertConsumerService } from './ecam-alert-consumer.service';
import { EcamAlertReporterService } from './ecam-alert-reporter.service';

describe('EcamAlertConsumerService', () => {
  let consumer: EcamAlertConsumerService;
  let reporter: EcamAlertReporterService;
  let roverAvailable: ReturnType<typeof signal<boolean>>;
  let roverConnected: ReturnType<typeof signal<boolean>>;
  let baseStationConnected: ReturnType<typeof signal<boolean>>;
  let roverClient: ReturnType<typeof signal<Ros | null>>;
  let baseStationClient: ReturnType<typeof signal<Ros | null>>;

  beforeEach(() => {
    roverAvailable = signal(false);
    roverConnected = signal(false);
    baseStationConnected = signal(false);
    roverClient = signal<Ros | null>(null);
    baseStationClient = signal<Ros | null>(null);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: RosConnection, useValue: { isConnected: roverConnected, client: roverClient } },
        {
          provide: BaseStationConnection,
          useValue: { isConnected: baseStationConnected, client: baseStationClient },
        },
        {
          provide: RosHeartbeatMonitor,
          useValue: { roverAvailable: roverAvailable.asReadonly(), baseStationAvailable: signal(false) },
        },
      ],
    });
    reporter = TestBed.inject(EcamAlertReporterService);
    consumer = TestBed.inject(EcamAlertConsumerService);
    TestBed.flushEffects();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('subscribes to aggregate snapshots through both connected bridges', () => {
    const subscriptions: Topic[] = [];
    vi.spyOn(Topic.prototype, 'subscribe').mockImplementation(function (this: Topic) {
      subscriptions.push(this);
    });
    vi.spyOn(Topic.prototype, 'unsubscribe').mockImplementation(() => {});

    roverClient.set(new Ros());
    baseStationClient.set(new Ros());
    roverConnected.set(true);
    baseStationConnected.set(true);
    TestBed.flushEffects();

    expect(subscriptions.map((topic) => topic.name)).toEqual(['/ecam/alerts', '/ecam/alerts']);
    expect(subscriptions.map((topic) => topic.ros)).toEqual([roverClient(), baseStationClient()]);
  });

  it('uses Rover state while available, then BaseStation state after Rover heartbeat loss', () => {
    const applyAggregate = (message: unknown) =>
      (consumer as unknown as { handleAggregate: (value: unknown) => void }).handleAggregate(message);
    roverAvailable.set(true);
    TestBed.flushEffects();

    applyAggregate({
      authority: 'rover',
      timestamp: { sec: 1, nanosec: 0 },
      sources: [{ source: 'driver', active_codes: ['POWER_BATTERY_LOW'] }],
    });
    applyAggregate({ authority: 'basestation', sources: [] });
    expect(consumer.activeAlerts().map((alert) => alert.code)).toEqual(['POWER_BATTERY_LOW']);

    roverAvailable.set(false);
    TestBed.flushEffects();
    applyAggregate({ authority: 'basestation', timestamp: { sec: 2, nanosec: 0 }, sources: [] });
    expect(consumer.activeAlerts().map((alert) => alert.code)).toEqual(['ROVER_HEARTBEAT_LOST']);
  });

  it('merges immediate ECAM-local alerts with shared reporter sources', () => {
    reporter.raise('ROVER_HEARTBEAT_LOST');
    (
      consumer as unknown as { handleAggregate: (value: unknown) => void }
    ).handleAggregate({
      authority: 'basestation',
      timestamp: { sec: 1, nanosec: 0 },
      sources: [{ source: 'driver', active_codes: ['ROVER_HEARTBEAT_LOST'] }],
    });

    expect(consumer.activeAlerts()).toEqual([
      expect.objectContaining({
        code: 'ROVER_HEARTBEAT_LOST',
        reporterSources: ['driver', 'ecam'],
      }),
    ]);
  });

  it('keeps a shared code active until every reporting source clears it', () => {
    const applyAggregate = (message: unknown) =>
      (consumer as unknown as { handleAggregate: (value: unknown) => void }).handleAggregate(message);
    const timestamp = { sec: 123, nanosec: 456_000_000 };

    applyAggregate({
      authority: 'basestation',
      timestamp,
      sources: [
        { source: 'driver', active_codes: ['POWER_BATTERY_LOW'] },
        { source: 'arm', active_codes: ['POWER_BATTERY_LOW'] },
      ],
    });
    expect(consumer.activeAlerts()[0]).toMatchObject({
      code: 'POWER_BATTERY_LOW',
      reporterSources: ['driver', 'arm'],
    });

    applyAggregate({
      authority: 'basestation',
      timestamp,
      sources: [
        { source: 'driver', active_codes: [] },
        { source: 'arm', active_codes: ['POWER_BATTERY_LOW'] },
      ],
    });
    expect(consumer.activeAlerts()[0].reporterSources).toEqual(['arm']);
  });
});
