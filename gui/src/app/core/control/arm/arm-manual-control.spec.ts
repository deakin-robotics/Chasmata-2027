import { TestBed } from '@angular/core/testing';

import { GamepadSnapshot } from '../../gamepad/gamepad-input';
import { ArmCommandPublisher } from './arm-command-publisher';
import { ArmManualControl } from './arm-manual-control';

describe('ArmManualControl', () => {
  let service: ArmManualControl;
  const createCommand = vi.fn();
  const publish = vi.fn();
  const publishStop = vi.fn();
  const releaseArmControl = vi.fn();

  beforeEach(() => {
    createCommand.mockReset();
    publish.mockReset();
    publishStop.mockReset();
    releaseArmControl.mockReset();
    createCommand.mockImplementation((_snapshot: GamepadSnapshot, axes: readonly number[]) => ({
      axes,
      buttons: [],
    }));
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ArmCommandPublisher,
          useValue: { createCommand, publish, publishStop, releaseArmControl },
        },
      ],
    });
    service = TestBed.inject(ArmManualControl);
  });

  it('builds the expanded Manual joint mapping', () => {
    const snapshot: GamepadSnapshot = {
      axes: [0.1, 0.2, 0.3, 0.4],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 12 ? 1 : 0)),
    };

    service.handle(snapshot);

    expect(createCommand).toHaveBeenCalledWith(snapshot, [-0.3, -0.4, 0, 0, 1, 0, -0.1, -0.2, 0, 0]);
    expect(publish).toHaveBeenCalledOnce();
  });

  it('leaves D-pad X unused in Manual mode', () => {
    const snapshot: GamepadSnapshot = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 15 ? 1 : 0)),
    };

    service.handle(snapshot);

    const axes = createCommand.mock.calls[0][1] as readonly number[];
    expect(axes.every((axis) => axis === 0)).toBe(true);
  });

  it('keeps the right stick on the Gimbal path while LB is held', () => {
    const snapshot: GamepadSnapshot = {
      axes: [0.1, 0.2, 0.3, 0.4],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 4 ? 1 : 0)),
    };

    service.handle(snapshot);

    expect(createCommand).toHaveBeenCalledWith(snapshot, [0, 0, 0, -0.3, -0.4, 0, -0.1, -0.2, 0, 0]);
  });

  it('can stop and release manual output', () => {
    service.stop();
    service.release();

    expect(publishStop).toHaveBeenCalledOnce();
    expect(releaseArmControl).toHaveBeenCalledOnce();
  });
});
