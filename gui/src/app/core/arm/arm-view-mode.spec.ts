import { TestBed } from '@angular/core/testing';

import { ArmViewModeService } from './arm-view-mode';

describe('ArmViewModeService', () => {
  let service: ArmViewModeService;

  beforeEach(() => {
    service = TestBed.inject(ArmViewModeService);
    service.reset();
  });

  it('enters FREE without changing the last canonical view', () => {
    service.set('top');
    service.setFree();

    expect(service.view()).toBe('free');
    expect(service.toggle()).toBe('side');
    expect(service.view()).toBe('side');
  });

  it('restores the canonical side view after FREE when side was selected', () => {
    service.set('side');
    service.setFree();

    expect(service.toggle()).toBe('top');
    expect(service.view()).toBe('top');
  });

  it('resets to side view', () => {
    service.set('top');
    service.setFree();
    service.reset();

    expect(service.view()).toBe('side');
    expect(service.toggle()).toBe('top');
  });
});
