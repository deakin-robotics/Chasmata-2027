import { TestBed } from '@angular/core/testing';

import { GamepadInput } from '../../gamepad/gamepad-input';
import { DriverControl } from './driver-control';

describe('DriverControl', () => {
  let service: DriverControl;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DriverControl);
  });

  afterEach(() => {
    service.disable();
  });

  it('should reject enabling control when ROS is disconnected', () => {
    expect(service.enable()).toBe(false);
    expect(service.readinessError()).toBe('Connect to ROSbridge before enabling Driver control.');
  });

  it('should start disabled', () => {
    expect(service.enabled()).toBe(false);
    expect(service.canDrive()).toBe(false);
  });

  it('keeps the gamepad monitor active when Driver control is disabled', () => {
    const gamepad = TestBed.inject(GamepadInput);
    const stop = vi.spyOn(gamepad, 'stop');

    service.disable();

    expect(stop).not.toHaveBeenCalled();
  });
});
