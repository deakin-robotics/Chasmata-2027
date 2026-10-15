import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Ros, Topic } from 'roslib';

import { BaseStationConnection } from '../ros/base-station-connection';
import { RosConnection } from '../ros/ros-connection';
import { RosHeartbeatMonitor } from '../ros/ros-heartbeat-monitor';
import { EcamAlertService } from './ecam-alert.service';

describe('EcamAlertService', () => {
  let service: EcamAlertService;
  let roverAvailable: ReturnType<typeof signal<boolean>>;
  let baseStationAvailable: ReturnType<typeof signal<boolean>>;
  let roverConnected: ReturnType<typeof signal<boolean>>;
  let baseStationConnected: ReturnType<typeof signal<boolean>>;
  let roverClient: ReturnType<typeof signal<Ros | null>>;
  let baseStationClient: ReturnType<typeof signal<Ros | null>>;

  beforeEach(() => {
    roverAvailable = signal(false);
    baseStationAvailable = signal(false);
    roverConnected = signal(false);
    baseStationConnected = signal(false);
    roverClient = signal<Ros | null>(null);
    baseStationClient = signal<Ros | null>(null);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: RosConnection,
          useValue: {
            isConnected: roverConnected.asReadonly(),
            client: roverClient.asReadonly(),
          },
        },
        {
          provide: BaseStationConnection,
          useValue: {
            isConnected: baseStationConnected.asReadonly(),
            client: baseStationClient.asReadonly(),
          },
        },
        {
          provide: RosHeartbeatMonitor,
          useValue: {
            roverAvailable: roverAvailable.asReadonly(),
            baseStationAvailable: baseStationAvailable.asReadonly(),
          },
        },
      ],
    });
    service = TestBed.inject(EcamAlertService);
    TestBed.flushEffects();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('should start without active alerts', () => {
    expect(service.activeAlerts()).toEqual([]);
    expect(service.hasActiveAlerts()).toBe(false);
  });

  it('should resolve a raised code through the central message catalogue', () => {
    service.raise('POWER_BATTERY_LOW', { detail: '22.8 V' });

    expect(service.activeAlerts()).toEqual([
      expect.objectContaining({
        code: 'POWER_BATTERY_LOW',
        source: 'POWER',
        severity: 'warning',
        text: 'BATTERY LOW',
        detail: '22.8 V',
      }),
    ]);
  });

  it('should catalogue rover camera fallback as an amber warning', () => {
    service.raise('CAMERA_ROVER_FALLBACK_ACTIVE');

    expect(service.activeAlerts()[0]).toMatchObject({
      code: 'CAMERA_ROVER_FALLBACK_ACTIVE',
      source: 'CAMERA',
      severity: 'warning',
      text: 'ROVER CAMERA FALLBACK ACTIVE',
    });
    expect(service.activeAlerts()[0].text).not.toContain('—');
  });

  it('should expose an optional remote procedure with the active alert', () => {
    service.raise('DRIVE_CONTROLLER_OFFLINE');

    expect(service.activeAlerts()[0].procedure).toEqual({
      steps: [
        { id: 'check-link', instruction: 'CONFIRM LINK GOOD' },
        { id: 'retry-controller', instruction: 'RETRY DRIVE-CONTROLLER CONNECTION' },
        { id: 'confirm-heartbeat', instruction: 'CONFIRM DRIVE-CONTROLLER HEARTBEAT' },
        { id: 'stop-driving', instruction: 'DO NOT DRIVE IF UNRESOLVED' },
        { id: 'mockup-placeholder', instruction: 'MOCK-UP — FINAL STEPS PENDING LEAD REVIEW' },
      ],
    });
  });

  it('should deduplicate a repeated alert code and preserve its first-seen time', () => {
    service.raise('CAMERA_FRONT_LOST', { detail: 'Timeout' });
    const firstSeenAt = service.activeAlerts()[0].firstSeenAt;

    service.raise('CAMERA_FRONT_LOST', { detail: 'No frames received' });

    expect(service.activeAlerts()).toHaveLength(1);
    expect(service.activeAlerts()[0]).toMatchObject({
      detail: 'No frames received',
      firstSeenAt,
    });
  });

  it('should order active alerts as faults, warnings, then attention messages', () => {
    service.raise('CONFIG_ARM_NOT_STOWED');
    service.raise('POWER_BATTERY_LOW');
    service.raise('DRIVE_CONTROLLER_OFFLINE');

    expect(service.activeAlerts().map((alert) => alert.code)).toEqual([
      'DRIVE_CONTROLLER_OFFLINE',
      'POWER_BATTERY_LOW',
      'CONFIG_ARM_NOT_STOWED',
    ]);
  });

  it('should clear a recovered alert without affecting other alerts', () => {
    service.raise('LINK_DEGRADED');
    service.raise('POWER_BATTERY_LOW');

    service.clear('LINK_DEGRADED');

    expect(service.activeAlerts().map((alert) => alert.code)).toEqual(['POWER_BATTERY_LOW']);
  });

  it('raises Rover heartbeat loss locally and clears it when Rover returns', () => {
    roverAvailable.set(true);
    TestBed.flushEffects();
    expect(service.activeAlerts()).toEqual([]);

    roverAvailable.set(false);
    TestBed.flushEffects();
    expect(service.activeAlerts().map((alert) => alert.code)).toEqual(['ROVER_HEARTBEAT_LOST']);

    roverAvailable.set(true);
    TestBed.flushEffects();
    expect(service.activeAlerts()).toEqual([]);
  });

  it('raises BaseStation heartbeat loss locally without waiting for a shared snapshot', () => {
    baseStationAvailable.set(true);
    TestBed.flushEffects();

    baseStationAvailable.set(false);
    TestBed.flushEffects();
    expect(service.activeAlerts().map((alert) => alert.code)).toEqual([
      'BASE_STATION_HEARTBEAT_LOST',
    ]);

    baseStationAvailable.set(true);
    TestBed.flushEffects();
    expect(service.activeAlerts()).toEqual([]);
  });

  it('does not raise BaseStation loss when only Rover becomes unavailable', () => {
    roverAvailable.set(true);
    baseStationAvailable.set(true);
    TestBed.flushEffects();

    roverAvailable.set(false);
    TestBed.flushEffects();
    expect(service.activeAlerts().map((alert) => alert.code)).toEqual(['ROVER_HEARTBEAT_LOST']);

    roverAvailable.set(true);
    TestBed.flushEffects();
    expect(service.activeAlerts()).toEqual([]);

    baseStationAvailable.set(false);
    TestBed.flushEffects();
    expect(service.activeAlerts().map((alert) => alert.code)).toEqual([
      'BASE_STATION_HEARTBEAT_LOST',
    ]);
  });

  it('routes complete source snapshots by Rover heartbeat, even while its socket remains connected', () => {
    const advertisedTopics: Topic[] = [];
    const publishedSnapshots: Array<{ source: string; active_codes: string[] }> = [];
    vi.spyOn(Topic.prototype, 'advertise').mockImplementation(function (this: Topic) {
      advertisedTopics.push(this);
    });
    vi.spyOn(Topic.prototype, 'unadvertise').mockImplementation(() => {});
    vi.spyOn(Topic.prototype, 'subscribe').mockImplementation(() => {});
    vi.spyOn(Topic.prototype, 'unsubscribe').mockImplementation(() => {});
    vi.spyOn(Topic.prototype, 'publish').mockImplementation(function (this: Topic, message) {
      if (this.name === '/ecam/alerts/source') {
        publishedSnapshots.push(message as { source: string; active_codes: string[] });
      }
    });

    roverClient.set(new Ros());
    baseStationClient.set(new Ros());
    roverConnected.set(true);
    baseStationConnected.set(true);
    roverAvailable.set(true);
    TestBed.flushEffects();

    publishedSnapshots.length = 0;
    service.raise('POWER_BATTERY_LOW');
    TestBed.flushEffects();

    expect(advertisedTopics).toHaveLength(1);
    expect(advertisedTopics[0].ros).toBe(roverClient());
    expect(publishedSnapshots).toHaveLength(1);
    expect(publishedSnapshots[0].active_codes).toEqual(['POWER_BATTERY_LOW']);

    roverAvailable.set(false);
    TestBed.flushEffects();

    expect(roverConnected()).toBe(true);
    expect(advertisedTopics).toHaveLength(2);
    expect(advertisedTopics[1].ros).toBe(baseStationClient());
    expect(publishedSnapshots.at(-1)?.active_codes).toEqual([
      'POWER_BATTERY_LOW',
      'ROVER_HEARTBEAT_LOST',
    ]);

    service.clear('POWER_BATTERY_LOW');
    TestBed.flushEffects();
    expect(publishedSnapshots.at(-1)?.active_codes).toEqual(['ROVER_HEARTBEAT_LOST']);

    roverAvailable.set(true);
    TestBed.flushEffects();
    expect(advertisedTopics).toHaveLength(3);
    expect(advertisedTopics[2].ros).toBe(roverClient());
    expect(publishedSnapshots.at(-1)?.active_codes).toEqual([]);
  });

  it('uses Rover combined snapshots while its heartbeat is available', () => {
    const applyAggregate = (message: unknown) =>
      (service as unknown as { handleAggregate: (value: unknown) => void }).handleAggregate(
        message,
      );
    roverAvailable.set(true);
    TestBed.flushEffects();

    applyAggregate({
      authority: 'rover',
      timestamp: { sec: 1, nanosec: 0 },
      sources: [{ source: 'driver', active_codes: ['POWER_BATTERY_LOW'] }],
    });
    applyAggregate({ authority: 'basestation', sources: [] });
    expect(service.activeAlerts().some((alert) => alert.code === 'POWER_BATTERY_LOW')).toBe(true);

    roverAvailable.set(false);
    TestBed.flushEffects();
    applyAggregate({ authority: 'basestation', sources: [] });
    expect(service.activeAlerts().some((alert) => alert.code === 'POWER_BATTERY_LOW')).toBe(false);
  });

  it('keeps a shared code active until every reporting source clears it', () => {
    const applyAggregate = (message: unknown) =>
      (service as unknown as { handleAggregate: (value: unknown) => void }).handleAggregate(
        message,
      );
    const timestamp = { sec: 123, nanosec: 456_000_000 };

    applyAggregate({
      authority: 'basestation',
      timestamp,
      sources: [
        { source: 'driver', timestamp, active_codes: ['POWER_BATTERY_LOW'] },
        { source: 'arm', timestamp, active_codes: ['POWER_BATTERY_LOW'] },
      ],
    });
    expect(service.activeAlerts().map((alert) => alert.code)).toEqual(['POWER_BATTERY_LOW']);
    expect(service.activeAlerts()[0].lastUpdatedAt).toBe(123_456);

    applyAggregate({
      authority: 'basestation',
      timestamp: { sec: 124, nanosec: 0 },
      sources: [
        { source: 'driver', timestamp, active_codes: [] },
        { source: 'arm', timestamp, active_codes: ['POWER_BATTERY_LOW'] },
      ],
    });
    expect(service.activeAlerts().map((alert) => alert.code)).toEqual(['POWER_BATTERY_LOW']);

    applyAggregate({
      authority: 'basestation',
      timestamp: { sec: 125, nanosec: 0 },
      sources: [
        { source: 'driver', timestamp, active_codes: [] },
        { source: 'arm', timestamp, active_codes: [] },
      ],
    });
    expect(service.activeAlerts()).toEqual([]);
  });
});
