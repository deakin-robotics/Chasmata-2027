import { TestBed } from '@angular/core/testing';

import { ControlModeService } from './control-mode';

describe('ControlModeService', () => {
  let service: ControlModeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ControlModeService);
  });

  it('should start with no active control', () => {
    expect(service.mode()).toBe('none');
    expect(service.hasActiveControl()).toBe(false);
  });

  it('should activate Pilot control', () => {
    service.activate('pilot');

    expect(service.mode()).toBe('pilot');
    expect(service.isPilotActive()).toBe(true);
    expect(service.isArmActive()).toBe(false);
  });

  it('should release active control', () => {
    service.activate('arm');
    service.release();

    expect(service.mode()).toBe('none');
    expect(service.hasActiveControl()).toBe(false);
  });
});
