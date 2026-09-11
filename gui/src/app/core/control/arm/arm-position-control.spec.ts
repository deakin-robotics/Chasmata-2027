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
  const adjustOrientation = vi.fn();
  const publishPositionButtons = vi.fn();
  const publishPositionWrist = vi.fn();
  const provider = signal<'closed-chain-ik' | 'moveit2'>('closed-chain-ik');
  const orientationMode = signal<'locked' | 'unlocked'>('unlocked');
  const snapshot: GamepadSnapshot = {
    axes: [1, -1, 0, 0],
    buttons: Array.from({ length: 16 }, (_, index) => (index === 12 ? 1 : 0)),
  };

  beforeEach(() => {
    translate.mockReset();
    adjustOrientation.mockReset();
    publishPositionButtons.mockReset();
    publishPositionWrist.mockReset();
    provider.set('closed-chain-ik');
    orientationMode.set('unlocked');
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ArmIkCoordinator,
          useValue: { translate, adjustOrientation, provider, orientationMode },
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

  it('translates the IK target from gamepad input', () => {
    service.handle(snapshot);

    expect(translate).toHaveBeenCalledWith([0.004, 0.004, -0.004]);
  });

  it('sends unlocked MoveIt2 wrist input separately from the J4 pivot target', () => {
    provider.set('moveit2');

    service.handle({
      axes: [1, -1, 0, 0],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 12 ? 1 : 0)),
    });

    expect(translate).toHaveBeenCalledWith([0, -0.004, 0.004]);
    expect(publishPositionWrist).toHaveBeenCalledOnce();
    expect(publishPositionButtons).not.toHaveBeenCalled();
  });

  it('keeps the MoveIt2 pivot in the visible X-Y plane from top view', () => {
    provider.set('moveit2');
    TestBed.inject(ArmViewModeService).set('top');

    service.handle({
      axes: [1, -1, 0, 0],
      buttons: Array.from({ length: 16 }, () => 0),
    });

    expect(translate).toHaveBeenCalledWith([0.004, 0.004, 0]);
  });

  it('keeps Position-mode buttons while locked orientation owns wrist axes', () => {
    provider.set('moveit2');
    orientationMode.set('locked');

    service.handle({
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 1 ? 1 : 0)),
    });

    expect(adjustOrientation).toHaveBeenCalledWith({ roll: 0, pitch: 0, yaw: 0 });
    expect(publishPositionButtons).toHaveBeenCalledOnce();
    expect(publishPositionWrist).not.toHaveBeenCalled();
  });

  it('inverts both D-pad axes for locked orientation control', () => {
    provider.set('moveit2');
    orientationMode.set('locked');

    service.handle({
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, (_, index) =>
        index === 12 || index === 14 ? 1 : 0,
      ),
    });

    const amount = Math.PI / 6 * 0.02;
    expect(adjustOrientation).toHaveBeenCalledWith({
      roll: 0,
      pitch: amount,
      yaw: -amount,
    });
  });

  it('inverts trigger roll direction for locked orientation control', () => {
    provider.set('moveit2');
    orientationMode.set('locked');

    service.handle({
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 7 ? 1 : 0)),
    });

    expect(adjustOrientation).toHaveBeenCalledWith({
      roll: -(Math.PI / 6 * 0.02),
      pitch: 0,
      yaw: 0,
    });
  });
});
