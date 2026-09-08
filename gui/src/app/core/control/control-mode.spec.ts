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

  it('should activate Driver control', () => {
    service.activate('driver');

    expect(service.mode()).toBe('driver');
    expect(service.isDriverActive()).toBe(true);
    expect(service.isArmActive()).toBe(false);
  });

  it('should release active control', () => {
    service.activate('arm');
    service.release();

    expect(service.mode()).toBe('none');
    expect(service.hasActiveControl()).toBe(false);
  });
});
