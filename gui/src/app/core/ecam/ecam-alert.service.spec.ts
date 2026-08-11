import { TestBed } from '@angular/core/testing';

import { EcamAlertService } from './ecam-alert.service';

describe('EcamAlertService', () => {
  let service: EcamAlertService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
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

  it('should expose an optional remote procedure with the active alert', () => {
    service.raise('DRIVE_CONTROLLER_OFFLINE');

    expect(service.activeAlerts()[0].procedure).toEqual({
      steps: [
        { id: 'check-link', instruction: 'Confirm LINK status is GOOD.' },
        { id: 'retry-controller', instruction: 'Retry the drive-controller connection.' },
        { id: 'confirm-heartbeat', instruction: 'Confirm the drive-controller heartbeat.' },
        { id: 'stop-driving', instruction: 'If unresolved, do not drive.' },
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

    expect(service.activeAlerts().map((alert) => alert.code)).toEqual([
      'POWER_BATTERY_LOW',
    ]);
  });
});
