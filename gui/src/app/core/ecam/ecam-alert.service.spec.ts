import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { EcamAlertService } from './ecam-alert.service';

describe('EcamAlertService', () => {
  let service: EcamAlertService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    service = TestBed.inject(EcamAlertService);
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
