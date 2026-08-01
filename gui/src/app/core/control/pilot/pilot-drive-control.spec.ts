import { TestBed } from '@angular/core/testing';

import { PilotDriveControl } from './pilot-drive-control';

describe('PilotDriveControl', () => {
  let service: PilotDriveControl;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PilotDriveControl);
  });

  afterEach(() => {
    service.disable();
  });

  it('should reject enabling control when ROS is disconnected', () => {
    expect(service.enable()).toBe(false);
    expect(service.readinessError()).toBe('Connect to ROSbridge before enabling Pilot control.');
  });

  it('should start disabled', () => {
    expect(service.enabled()).toBe(false);
    expect(service.canDrive()).toBe(false);
  });
});
