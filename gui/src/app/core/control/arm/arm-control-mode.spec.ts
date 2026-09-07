import { TestBed } from '@angular/core/testing';

import { ArmMode } from '../../fma/fma-state.service';
import { ArmControlModeService } from './arm-control-mode';

describe('ArmControlModeService', () => {
  let service: ArmControlModeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ArmControlModeService);
  });

  it('starts in Position mode', () => {
    expect(service.mode()).toBe(ArmMode.Position);
    expect(service.isPosition()).toBe(true);
    expect(service.isManual()).toBe(false);
  });

  it('switches between Manual and Position mode', () => {
    service.setMode(ArmMode.Manual);

    expect(service.mode()).toBe(ArmMode.Manual);
    expect(service.isManual()).toBe(true);
    expect(service.isPosition()).toBe(false);

    service.setMode(ArmMode.Position);

    expect(service.mode()).toBe(ArmMode.Position);
    expect(service.isPosition()).toBe(true);
    expect(service.isManual()).toBe(false);
  });
});
