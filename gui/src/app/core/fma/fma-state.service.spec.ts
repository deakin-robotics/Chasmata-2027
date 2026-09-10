import { TestBed } from '@angular/core/testing';

import { ArmMode, DriveMode, FmaStateService } from './fma-state.service';

describe('FmaStateService', () => {
  let service: FmaStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FmaStateService);
  });

  it('starts DRIVE and ARM without confirmed or pending modes', () => {
    expect(service.columns()).toEqual(
      expect.arrayContaining([
        { label: 'DRIVE', confirmed: null, commanded: null },
        { label: 'ARM', confirmed: null, commanded: null },
      ]),
    );
  });

  it('starts telemetry-backed LAW, GIMBAL, and SYSTEM states as unknown', () => {
    expect(service.columns()).toEqual(
      expect.arrayContaining([
        { label: 'LAW', confirmed: null, commanded: null },
        { label: 'GIMBAL', confirmed: null, commanded: null },
        { label: 'SYSTEM', confirmed: null, commanded: null },
      ]),
    );
  });

  it('keeps DRIVE confirmed state unchanged while a request is pending', () => {
    service.requestDriveMode(DriveMode.Velocity);

    expect(service.columns()).toEqual(
      expect.arrayContaining([{ label: 'DRIVE', confirmed: null, commanded: DriveMode.Velocity }]),
    );
  });

  it('confirms and clears a DRIVE request', () => {
    service.requestDriveMode(DriveMode.Velocity);
    service.confirmDriveMode(DriveMode.Velocity);

    expect(service.columns()).toEqual(
      expect.arrayContaining([{ label: 'DRIVE', confirmed: DriveMode.Velocity, commanded: null }]),
    );
  });

  it('rejects an ARM request without changing its confirmed state', () => {
    service.requestArmMode(ArmMode.Position);
    service.rejectArmMode();

    expect(service.columns()).toEqual(
      expect.arrayContaining([{ label: 'ARM', confirmed: null, commanded: null }]),
    );
  });

  it('starts gimbal priority unknown and formats authoritative owners', () => {
    expect(service.gimbalPriorityOwner()).toBeNull();
    expect(service.gimbalPriorityDisplay()).toBe('GIMBAL PRIORITY UNKNOWN');

    service.setGimbalPriorityOwner('DRIVER');
    expect(service.gimbalPriorityDisplay()).toBe('← DRIVER');

    service.setGimbalPriorityOwner('ARM OPS');
    expect(service.gimbalPriorityDisplay()).toBe('ARM OPS →');
  });
});
