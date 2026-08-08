import { TestBed } from '@angular/core/testing';

import { ControlModeService } from '../control-mode';
import { ArmCommandPublisher } from './arm-command-publisher';

describe('ArmCommandPublisher', () => {
  let controlMode: ControlModeService;
  let service: ArmCommandPublisher;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    controlMode = TestBed.inject(ControlModeService);
    service = TestBed.inject(ArmCommandPublisher);
  });

  it('should not publish while Arm control is inactive', () => {
    expect(service.canPublish()).toBe(false);
    expect(service.publish({ axes: [0, 0, 0, 0], buttons: [] })).toBe(false);
  });

  it('should release Arm authority when stopping control', () => {
    controlMode.activate('arm');

    service.releaseArmControl();

    expect(controlMode.mode()).toBe('none');
  });
});
