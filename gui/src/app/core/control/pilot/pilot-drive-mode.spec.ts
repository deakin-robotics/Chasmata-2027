import { TestBed } from '@angular/core/testing';

import { DriveMode } from '../../fma/fma-state.service';
import { PilotDriveModeService } from './pilot-drive-mode';

describe('PilotDriveModeService', () => {
  let service: PilotDriveModeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PilotDriveModeService);
  });

  it('should default to Manual mode', () => {
    expect(service.mode()).toBe(DriveMode.Manual);
    expect(service.isManual()).toBe(true);
  });

  it('should update the selected drive mode', () => {
    service.setMode(DriveMode.Velocity);

    expect(service.mode()).toBe(DriveMode.Velocity);
    expect(service.isVelocity()).toBe(true);
  });
});
