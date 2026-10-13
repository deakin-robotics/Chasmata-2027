import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';

import { ArmIkCoordinator } from '../../arm/ik/arm-ik-coordinator';
import { GamepadInput } from '../../gamepad/gamepad-input';
import { ArmMode } from '../../fma/fma-state.service';
import { GimbalPriorityCommandPublisher } from '../gimbal-priority-command-publisher';
import { ArmManualControl } from './arm-manual-control';
import { ArmControlModeService } from './arm-control-mode';
import { ArmPositionControl } from './arm-position-control';

describe('ArmControlModeService', () => {
  let service: ArmControlModeService;
  let orientationMode: WritableSignal<'locked' | 'unlocked'>;
  let setOrientationMode: ReturnType<typeof vi.fn>;
  let resynchronizeTargetFromTelemetry: ReturnType<typeof vi.fn>;
  let publishGimbalPriority: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    orientationMode = signal<'locked' | 'unlocked'>('unlocked');
    setOrientationMode = vi.fn((mode: 'locked' | 'unlocked') => {
      orientationMode.set(mode);
      return true;
    });
    resynchronizeTargetFromTelemetry = vi.fn();
    publishGimbalPriority = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
        provide: ArmIkCoordinator,
          useValue: {
            orientationMode,
            setOrientationMode,
            resynchronizeTargetFromTelemetry,
            translate: vi.fn(),
          },
        },
        {
          provide: GimbalPriorityCommandPublisher,
          useValue: { publish: publishGimbalPriority },
        },
      ],
    });
    service = TestBed.inject(ArmControlModeService);
  });

  it('starts in Position mode', () => {
    expect(service.mode()).toBe(ArmMode.Position);
    expect(service.isPosition()).toBe(true);
    expect(service.isManual()).toBe(false);
  });

  it('switches between Manual and Position mode', () => {
    service.setMode(ArmMode.Manual);

    expect(service.mode()).toBe(ArmMode.Manual);
    expect(service.isManual()).toBe(true);
    expect(service.isPosition()).toBe(false);

    service.setMode(ArmMode.Position);

    expect(service.mode()).toBe(ArmMode.Position);
    expect(service.isPosition()).toBe(true);
    expect(service.isManual()).toBe(false);
    expect(resynchronizeTargetFromTelemetry).toHaveBeenCalledOnce();
  });

  it('selects the matching control worker', () => {
    expect(service.selectedControl()).toBe(TestBed.inject(ArmPositionControl));

    service.setMode(ArmMode.Manual);

    expect(service.selectedControl()).toBe(TestBed.inject(ArmManualControl));
  });

  it('routes input to the handler selected by the current mode', () => {
    const snapshot = { axes: [0, 0, 0, 0], buttons: [] };
    const manual = vi.spyOn(TestBed.inject(ArmManualControl), 'handle');
    const position = vi.spyOn(TestBed.inject(ArmPositionControl), 'handle');

    service.route(snapshot);
    expect(position).toHaveBeenCalledWith(snapshot);
    expect(manual).not.toHaveBeenCalled();

    service.setMode(ArmMode.Manual);
    service.route(snapshot);
    expect(manual).toHaveBeenCalledWith(snapshot);
  });

  it('keeps the gamepad monitor active when Arm control is disabled', () => {
    const gamepad = TestBed.inject(GamepadInput);
    const stop = vi.spyOn(gamepad, 'stop');

    service.disable();

    expect(stop).not.toHaveBeenCalled();
  });

  it('toggles orientation lock once per L3 press in Position mode', () => {
    const pressed = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 10 ? 1 : 0)),
    };
    const released = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => 0) };

    service.route(pressed);
    service.route(pressed);
    expect(setOrientationMode).toHaveBeenCalledOnce();
    expect(setOrientationMode).toHaveBeenLastCalledWith('locked');

    service.route(released);
    service.route(pressed);
    expect(setOrientationMode).toHaveBeenCalledTimes(2);
    expect(setOrientationMode).toHaveBeenLastCalledWith('unlocked');
  });

  it('ignores L3 orientation toggles in Manual mode', () => {
    service.setMode(ArmMode.Manual);
    setOrientationMode.mockClear();

    service.route({
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 10 ? 1 : 0)),
    });

    expect(setOrientationMode).not.toHaveBeenCalled();
  });

  it('keeps R3 dedicated to Gimbal priority', () => {
    const pressed = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 11 ? 1 : 0)),
    };

    service.route(pressed);
    service.route(pressed);

    expect(publishGimbalPriority).toHaveBeenCalledOnce();
    expect(publishGimbalPriority).toHaveBeenCalledWith('ARM OPS');
  });
});
