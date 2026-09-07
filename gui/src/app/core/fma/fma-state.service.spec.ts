import { TestBed } from '@angular/core/testing';

import { ArmMode, DriveMode, FmaStateService } from './fma-state.service';

describe('FmaStateService', () => {
  let service: FmaStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FmaStateService);
  });

  it('starts DRIVE and ARM with confirmed modes and no pending request', () => {
    expect(service.columns()).toEqual(
      expect.arrayContaining([
        { label: 'DRIVE', confirmed: DriveMode.Manual, commanded: null },
        { label: 'ARM', confirmed: ArmMode.Manual, commanded: null },
      ]),
    );
  });

  it('keeps DRIVE confirmed state unchanged while a request is pending', () => {
    service.requestDriveMode(DriveMode.Velocity);

    expect(service.columns()).toEqual(
      expect.arrayContaining([
        { label: 'DRIVE', confirmed: DriveMode.Manual, commanded: DriveMode.Velocity },
      ]),
    );
  });

  it('confirms and clears a DRIVE request', () => {
    service.requestDriveMode(DriveMode.Velocity);
    service.confirmDriveMode(DriveMode.Velocity);

    expect(service.columns()).toEqual(
      expect.arrayContaining([
        { label: 'DRIVE', confirmed: DriveMode.Velocity, commanded: null },
      ]),
    );
  });

  it('rejects an ARM request without changing its confirmed state', () => {
    service.requestArmMode(ArmMode.Position);
    service.rejectArmMode();

    expect(service.columns()).toEqual(
      expect.arrayContaining([
        { label: 'ARM', confirmed: ArmMode.Manual, commanded: null },
      ]),
    );
  });
});
