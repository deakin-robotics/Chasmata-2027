import { TestBed } from '@angular/core/testing';

import { ArmIkCoordinator } from '../../arm/ik/arm-ik-coordinator';
import { GamepadSnapshot } from '../../gamepad/gamepad-input';
import { ArmPositionControl } from './arm-position-control';

describe('ArmPositionControl', () => {
  let service: ArmPositionControl;
  const translate = vi.fn();
  const snapshot: GamepadSnapshot = {
    axes: [1, -1, 0, 0],
    buttons: Array.from({ length: 16 }, (_, index) => (index === 12 ? 1 : 0)),
  };

  beforeEach(() => {
    translate.mockReset();
    TestBed.configureTestingModule({
      providers: [{ provide: ArmIkCoordinator, useValue: { translate } }],
    });
    service = TestBed.inject(ArmPositionControl);
  });

  it('translates the IK target from gamepad input', () => {
    service.handle(snapshot);

    expect(translate).toHaveBeenCalledWith([0.004, 0.004, 0.004]);
  });
});
