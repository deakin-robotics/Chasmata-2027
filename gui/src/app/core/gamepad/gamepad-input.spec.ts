import { TestBed } from '@angular/core/testing';

import { GamepadInput } from './gamepad-input';

describe('GamepadInput', () => {
  let service: GamepadInput;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GamepadInput);
  });

  it('should start without an active gamepad', () => {
    expect(service.connected()).toBe(false);
    expect(service.snapshot()).toBeNull();
  });

  it('should clear its state when monitoring stops', () => {
    service.stop();

    expect(service.connected()).toBe(false);
    expect(service.name()).toBeNull();
    expect(service.snapshot()).toBeNull();
  });
});
