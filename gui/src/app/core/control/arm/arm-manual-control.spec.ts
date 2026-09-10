import { TestBed } from '@angular/core/testing';

import { GamepadSnapshot } from '../../gamepad/gamepad-input';
import { ArmCommandPublisher } from './arm-command-publisher';
import { ArmManualControl } from './arm-manual-control';

describe('ArmManualControl', () => {
  let service: ArmManualControl;
  const publish = vi.fn();
  const publishStop = vi.fn();
  const releaseArmControl = vi.fn();
  const snapshot: GamepadSnapshot = { axes: [1, 2], buttons: [0] };

  beforeEach(() => {
    publish.mockReset();
    publishStop.mockReset();
    releaseArmControl.mockReset();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ArmCommandPublisher,
          useValue: { publish, publishStop, releaseArmControl },
        },
      ],
    });
    service = TestBed.inject(ArmManualControl);
  });

  it('forwards gamepad input to the manual command publisher', () => {
    service.handle(snapshot);

    expect(publish).toHaveBeenCalledWith(snapshot);
  });

  it('can stop and release manual output', () => {
    service.stop();
    service.release();

    expect(publishStop).toHaveBeenCalledOnce();
    expect(releaseArmControl).toHaveBeenCalledOnce();
  });
});
