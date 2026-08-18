import { TestBed } from '@angular/core/testing';

import { ArmControl } from './arm-control';

describe('ArmControl', () => {
  let service: ArmControl;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ArmControl);
  });

  afterEach(() => {
    service.disable();
  });

  it('should reject enabling control when ROS is disconnected', () => {
    expect(service.enable()).toBe(false);
    expect(service.readinessError()).toBe('Connect to ROSbridge before enabling Arm control.');
  });

  it('should start disabled', () => {
    expect(service.enabled()).toBe(false);
    expect(service.canControlArm()).toBe(false);
  });
});
