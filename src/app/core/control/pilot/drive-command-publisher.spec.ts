import { TestBed } from '@angular/core/testing';

import { ControlModeService } from '../control-mode';
import { DriveCommandPublisher } from './drive-command-publisher';

describe('DriveCommandPublisher', () => {
  let controlMode: ControlModeService;
  let service: DriveCommandPublisher;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    controlMode = TestBed.inject(ControlModeService);
    service = TestBed.inject(DriveCommandPublisher);
  });

  it('should not publish while Pilot control is inactive', () => {
    expect(service.canPublish()).toBe(false);
    expect(service.publish({ axes: [0, 0, 0, 0], buttons: [] })).toBe(false);
  });

  it('should release Pilot authority when stopping control', () => {
    controlMode.activate('pilot');

    service.releasePilotControl();

    expect(controlMode.mode()).toBe('none');
  });
});
