import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { ArmIkCoordinator } from '../../arm/ik/arm-ik-coordinator';
import { ArmViewModeService } from '../../arm/arm-view-mode';
import { GamepadSnapshot } from '../../gamepad/gamepad-input';
import { ArmCommandPublisher } from './arm-command-publisher';
import { ArmPositionControl } from './arm-position-control';

describe('ArmPositionControl', () => {
  let service: ArmPositionControl;
  const translate = vi.fn();
  const publishPositionButtons = vi.fn();
  const publishPositionWrist = vi.fn();
  const orientationMode = signal<'locked' | 'unlocked'>('unlocked');

  beforeEach(() => {
    translate.mockReset();
    publishPositionButtons.mockReset();
    publishPositionWrist.mockReset();
    orientationMode.set('unlocked');
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ArmIkCoordinator,
          useValue: { translate, orientationMode },
        },
        {
          provide: ArmCommandPublisher,
          useValue: { publishPositionButtons, publishPositionWrist },
        },
      ],
    });
    TestBed.inject(ArmViewModeService).set('side');
    service = TestBed.inject(ArmPositionControl);
  });

  it('moves the J4 pivot with the D-pad in the visible side plane', () => {
    service.handle({
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 12 ? 1 : 0)),
    });

    expect(translate).toHaveBeenCalledWith([0, 0, 0.004]);
    expect(publishPositionWrist).toHaveBeenCalledOnce();
  });

  it('moves the J4 pivot in the visible top plane', () => {
    TestBed.inject(ArmViewModeService).set('top');

    service.handle({
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, (_, index) =>
        index === 15 || index === 12 ? 1 : 0,
      ),
    });

    expect(translate).toHaveBeenCalledWith([0.004, 0.004, 0]);
  });

  it('keeps direct wrist input separate from the pivot target while unlocked', () => {
    const snapshot: GamepadSnapshot = {
      axes: [1, -1, 0, 0],
      buttons: Array.from({ length: 16 }, () => 0),
    };

    service.handle(snapshot);

    expect(publishPositionWrist).toHaveBeenCalledWith(snapshot);
    expect(publishPositionButtons).not.toHaveBeenCalled();
  });

  it('ignores wrist input while locked but keeps digital buttons active', () => {
    orientationMode.set('locked');
    const snapshot: GamepadSnapshot = {
      axes: [1, -1, 0, 0],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 7 ? 1 : 0)),
    };

    service.handle(snapshot);

    expect(publishPositionButtons).toHaveBeenCalledWith(snapshot);
    expect(publishPositionWrist).not.toHaveBeenCalled();
  });

  it('keeps locked D-pad target movement active', () => {
    orientationMode.set('locked');

    service.handle({
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 15 ? 1 : 0)),
    });

    expect(translate).toHaveBeenCalledWith([0, -0.004, 0]);
    expect(publishPositionButtons).toHaveBeenCalledOnce();
  });
});
