import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';

import { ArmIkCoordinator } from '../../arm/ik/arm-ik-coordinator';
import { GamepadInput, GamepadSnapshot } from '../../gamepad/gamepad-input';
import { ArmMode } from '../../fma/fma-state.service';
import { RosHeartbeatMonitor } from '../../ros/ros-heartbeat-monitor';
import { GimbalPriorityCommandPublisher } from '../gimbal-priority-command-publisher';
import { ControlModeService } from '../control-mode';
import { DriverControl } from '../drive/driver-control';
import { ArmCommandPublisher } from './arm-command-publisher';
import { ArmManualControl } from './arm-manual-control';
import { ArmControlModeService } from './arm-control-mode';
import { ArmPositionControl } from './arm-position-control';

describe('ArmControlModeService', () => {
  let service: ArmControlModeService;
  let orientationMode: WritableSignal<'locked' | 'unlocked'>;
  let setOrientationMode: ReturnType<typeof vi.fn>;
  let resynchronizeTargetFromTelemetry: ReturnType<typeof vi.fn>;
  let publishGimbalPriority: ReturnType<typeof vi.fn>;
  let roverAvailable: WritableSignal<boolean>;
  let baseStationAvailable: WritableSignal<boolean>;
  let gamepadConnected: WritableSignal<boolean>;
  let gamepadSnapshot: WritableSignal<GamepadSnapshot | null>;

  beforeEach(() => {
    orientationMode = signal<'locked' | 'unlocked'>('unlocked');
    setOrientationMode = vi.fn((mode: 'locked' | 'unlocked') => {
      orientationMode.set(mode);
      return true;
    });
    resynchronizeTargetFromTelemetry = vi.fn();
    publishGimbalPriority = vi.fn();
    roverAvailable = signal(true);
    baseStationAvailable = signal(true);
    gamepadConnected = signal(true);
    gamepadSnapshot = signal<GamepadSnapshot | null>({ axes: [1, 0, 0, 0], buttons: [] });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: GamepadInput,
          useValue: { start: vi.fn(), stop: vi.fn(), connected: gamepadConnected.asReadonly(),
            snapshot: gamepadSnapshot.asReadonly(), name: signal<string | null>(null).asReadonly() },
        },
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
        {
          provide: RosHeartbeatMonitor,
          useValue: {
            roverAvailable: roverAvailable.asReadonly(),
            baseStationAvailable: baseStationAvailable.asReadonly(),
          },
        },
      ],
    });
    service = TestBed.inject(ArmControlModeService);
  });

  it('starts in Manual mode', () => {
    expect(service.mode()).toBe(ArmMode.Manual);
    expect(service.isPosition()).toBe(false);
    expect(service.isManual()).toBe(true);
  });

  it('requires the BaseStation link before enabling Position control', () => {
    baseStationAvailable.set(false);
    service.setMode(ArmMode.Position);

    expect(service.readiness()).toBe(
      'Connect to the BaseStation before enabling Position control.',
    );

    service.setMode(ArmMode.Manual);

    expect(service.readiness()).not.toBe(
      'Connect to the BaseStation before enabling Position control.',
    );
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
    expect(service.selectedControl()).toBe(TestBed.inject(ArmManualControl));

    service.setMode(ArmMode.Position);

    expect(service.selectedControl()).toBe(TestBed.inject(ArmPositionControl));
  });

  it('routes input to the handler selected by the current mode', () => {
    const snapshot = { axes: [0, 0, 0, 0], buttons: [] };
    const manual = vi.spyOn(TestBed.inject(ArmManualControl), 'handle');
    const position = vi.spyOn(TestBed.inject(ArmPositionControl), 'handle');

    service.route(snapshot);
    expect(manual).toHaveBeenCalledWith(snapshot);
    expect(position).not.toHaveBeenCalled();

    service.setMode(ArmMode.Position);
    service.route(snapshot);
    expect(position).toHaveBeenCalledWith(snapshot);
  });

  it('keeps the gamepad monitor active when Arm control is disabled', () => {
    const gamepad = TestBed.inject(GamepadInput);
    const stop = vi.spyOn(gamepad, 'stop');

    service.disable();

    expect(stop).not.toHaveBeenCalled();
  });

  it.each(['rover', 'gamepad'] as const)(
    'retains Arm authority and resumes after %s reconnects', (lost) => {
      vi.useFakeTimers();
      const control = TestBed.inject(ControlModeService);
      const stop = vi.spyOn(TestBed.inject(ArmCommandPublisher), 'publishStop');
      const handle = vi.spyOn(TestBed.inject(ArmManualControl), 'handle');
      expect(service.enable()).toBe(true);
      (lost === 'rover' ? roverAvailable : gamepadConnected).set(false);
      vi.advanceTimersByTime(20);
      expect(service.enabled()).toBe(true);
      expect(service.canControlArm()).toBe(false);
      expect(control.isArmActive()).toBe(true);
      expect(handle).not.toHaveBeenCalled();
      if (lost === 'gamepad') expect(stop).toHaveBeenCalled();
      else expect(stop).not.toHaveBeenCalled();
      (lost === 'rover' ? roverAvailable : gamepadConnected).set(true);
      vi.advanceTimersByTime(20);
      expect(service.canControlArm()).toBe(true);
      expect(handle).toHaveBeenCalledOnce();
      service.disable();
      vi.useRealTimers();
    },
  );

  it('does not resume Arm when switched off while disconnected', () => {
    vi.useFakeTimers();
    const handle = vi.spyOn(TestBed.inject(ArmManualControl), 'handle');
    expect(service.enable()).toBe(true);
    roverAvailable.set(false);
    vi.advanceTimersByTime(20);
    service.disable();
    roverAvailable.set(true);
    vi.advanceTimersByTime(40);
    expect(service.enabled()).toBe(false);
    expect(TestBed.inject(ControlModeService).hasActiveControl()).toBe(false);
    expect(handle).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('keeps Driver and Arm authority exclusive through an interruption', () => {
    vi.useFakeTimers();
    const driver = TestBed.inject(DriverControl);
    expect(service.enable()).toBe(true);
    roverAvailable.set(false);
    vi.advanceTimersByTime(20);
    roverAvailable.set(true);
    expect(driver.enable()).toBe(false);
    expect(driver.readinessError()).toBe('Release Arm control before enabling Driver control.');
    service.disable();
    expect(driver.enable()).toBe(true);
    expect(service.enable()).toBe(false);
    expect(service.readinessError()).toBe('Release Driver control before enabling Arm control.');
    driver.disable();
    vi.useRealTimers();
  });

  it('toggles orientation lock once per L3 press in Position mode', () => {
    const pressed = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 10 ? 1 : 0)),
    };
    const released = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => 0) };

    service.setMode(ArmMode.Position);

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
