import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Ros, Topic } from 'roslib';

import { BaseStationConnection } from '../ros/base-station-connection';
import { RosConnection } from '../ros/ros-connection';
import { RosHeartbeatMonitor } from '../ros/ros-heartbeat-monitor';
import { EcamAlertReporterService } from './ecam-alert-reporter.service';

describe('EcamAlertReporterService', () => {
  let service: EcamAlertReporterService;
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
        { provide: RosConnection, useValue: { isConnected: roverConnected, client: roverClient } },
        {
          provide: BaseStationConnection,
          useValue: { isConnected: baseStationConnected, client: baseStationClient },
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
    service = TestBed.inject(EcamAlertReporterService);
    TestBed.flushEffects();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('starts without local alerts', () => {
    expect(service.localAlerts()).toEqual([]);
  });

  it('raises and clears local alerts through the catalogue', () => {
    service.raise('POWER_BATTERY_LOW', { detail: '22.8 V' });
    expect(service.localAlerts()).toEqual([
      expect.objectContaining({
        code: 'POWER_BATTERY_LOW',
        detail: '22.8 V',
        reporterSources: ['ecam'],
      }),
    ]);

    service.clear('POWER_BATTERY_LOW');
    expect(service.localAlerts()).toEqual([]);
  });

  it('preserves the first-seen time for a repeated local alert', () => {
    service.raise('CAMERA_FRONT_LOST', { detail: 'Timeout' });
    const firstSeenAt = service.localAlerts()[0].firstSeenAt;

    service.raise('CAMERA_FRONT_LOST', { detail: 'No frames received' });
    expect(service.localAlerts()).toEqual([
      expect.objectContaining({ detail: 'No frames received', firstSeenAt }),
    ]);
  });

  it('exposes catalogue procedures and severity through local alerts', () => {
    service.raise('DRIVE_CONTROLLER_OFFLINE');
    service.raise('CAMERA_ROVER_FALLBACK_ACTIVE');

    expect(service.localAlerts().find((alert) => alert.code === 'DRIVE_CONTROLLER_OFFLINE')?.procedure)
      .toEqual(expect.objectContaining({ steps: expect.any(Array) }));
    expect(service.localAlerts().find((alert) => alert.code === 'CAMERA_ROVER_FALLBACK_ACTIVE'))
      .toEqual(expect.objectContaining({ severity: 'warning', text: 'ROVER CAMERA FALLBACK ACTIVE' }));
  });

  it('publishes the source identity for Driver and Arm routes', () => {
    const publishedSnapshots: Array<{ source: string; active_codes: string[] }> = [];
    vi.spyOn(Topic.prototype, 'advertise').mockImplementation(() => {});
    vi.spyOn(Topic.prototype, 'unadvertise').mockImplementation(() => {});
    vi.spyOn(Topic.prototype, 'publish').mockImplementation(function (this: Topic, message) {
      if (this.name === '/ecam/alerts/source') {
        publishedSnapshots.push(message as { source: string; active_codes: string[] });
      }
    });
    roverClient.set(new Ros());
    roverConnected.set(true);
    roverAvailable.set(true);
    TestBed.flushEffects();

    (service as unknown as { setActiveSource: (source: 'driver' | 'arm') => void }).setActiveSource(
      'driver',
    );
    service.raise('POWER_BATTERY_LOW');
    TestBed.flushEffects();
    expect(publishedSnapshots.at(-1)).toMatchObject({ source: 'driver' });

    (service as unknown as { setActiveSource: (source: 'driver' | 'arm') => void }).setActiveSource(
      'arm',
    );
    TestBed.flushEffects();
    expect(publishedSnapshots.at(-1)).toMatchObject({ source: 'arm' });
    expect(service.localAlerts()[0].reporterSources).toEqual(['arm']);
  });

  it('publishes complete local snapshots through Rover, then BaseStation after Rover heartbeat loss', () => {
    const advertisedTopics: Topic[] = [];
    const publishedSnapshots: Array<{ source: string; active_codes: string[] }> = [];
    vi.spyOn(Topic.prototype, 'advertise').mockImplementation(function (this: Topic) {
      advertisedTopics.push(this);
    });
    vi.spyOn(Topic.prototype, 'unadvertise').mockImplementation(() => {});
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

    service.raise('POWER_BATTERY_LOW');
    TestBed.flushEffects();
    expect(advertisedTopics[0].ros).toBe(roverClient());
    expect(publishedSnapshots.at(-1)).toMatchObject({
      source: 'ecam',
      active_codes: ['POWER_BATTERY_LOW'],
    });

    roverAvailable.set(false);
    TestBed.flushEffects();
    expect(advertisedTopics[1].ros).toBe(baseStationClient());
    expect(publishedSnapshots.at(-1)?.active_codes).toEqual([
      'POWER_BATTERY_LOW',
      'ROVER_HEARTBEAT_LOST',
    ]);
  });

  it('raises and clears heartbeat alerts locally', () => {
    roverAvailable.set(true);
    baseStationAvailable.set(true);
    TestBed.flushEffects();

    roverAvailable.set(false);
    baseStationAvailable.set(false);
    TestBed.flushEffects();
    expect(service.localAlerts().map((alert) => alert.code)).toEqual([
      'ROVER_HEARTBEAT_LOST',
      'BASE_STATION_HEARTBEAT_LOST',
    ]);

    roverAvailable.set(true);
    baseStationAvailable.set(true);
    TestBed.flushEffects();
    expect(service.localAlerts()).toEqual([]);
  });
});
