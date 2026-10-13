import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';

import { GamepadInput, GamepadSnapshot } from '../../gamepad/gamepad-input';
import { RosConnection } from '../../ros/ros-connection';
import { ControlModeService } from '../control-mode';
import { GimbalPriorityCommandPublisher } from '../gimbal-priority-command-publisher';
import { DriveCommandPublisher } from './drive-command-publisher';
import { DriverControl } from './driver-control';

describe('DriverControl', () => {
  let service: DriverControl;
  let rosConnected: WritableSignal<boolean>;
  let gamepadConnected: WritableSignal<boolean>;
  let gamepadSnapshot: WritableSignal<GamepadSnapshot | null>;
  let controlModeState: WritableSignal<'none' | 'driver'>;
  let publishStop: ReturnType<typeof vi.fn>;
  let releaseDriverControl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rosConnected = signal(false);
    gamepadConnected = signal(false);
    gamepadSnapshot = signal<GamepadSnapshot | null>(null);
    controlModeState = signal<'none' | 'driver'>('none');
    publishStop = vi.fn();
    releaseDriverControl = vi.fn(() => controlModeState.set('none'));

    TestBed.configureTestingModule({
      providers: [
        {
          provide: RosConnection,
          useValue: {
            isConnected: rosConnected.asReadonly(),
          },
        },
        {
          provide: GamepadInput,
          useValue: {
            start: vi.fn(),
            stop: vi.fn(),
            connected: gamepadConnected.asReadonly(),
            snapshot: gamepadSnapshot.asReadonly(),
            name: signal<string | null>(null).asReadonly(),
          },
        },
        {
          provide: ControlModeService,
          useValue: {
            isArmActive: vi.fn(() => false),
            isDriverActive: vi.fn(() => controlModeState() === 'driver'),
            activate: vi.fn(() => controlModeState.set('driver')),
            release: vi.fn(() => controlModeState.set('none')),
          },
        },
        {
          provide: GimbalPriorityCommandPublisher,
          useValue: { publish: vi.fn() },
        },
        {
          provide: DriveCommandPublisher,
          useValue: {
            canPublish: vi.fn(() => rosConnected() && controlModeState() === 'driver'),
            publish: vi.fn(),
            publishStop,
            releaseDriverControl,
          },
        },
      ],
    });
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

  it('keeps Driver enabled and sends stop during a transient snapshot gap', () => {
    vi.useFakeTimers();
    rosConnected.set(true);
    gamepadConnected.set(true);
    gamepadSnapshot.set({ axes: [0, 0, 0, 0], buttons: [] });

    expect(service.enable()).toBe(true);

    gamepadSnapshot.set(null);
    vi.advanceTimersByTime(20);

    expect(service.enabled()).toBe(true);
    expect(publishStop).toHaveBeenCalledOnce();
    expect(releaseDriverControl).not.toHaveBeenCalled();
  });

  it('keeps Driver enabled and sends stop when the snapshot has too few axes', () => {
    vi.useFakeTimers();
    rosConnected.set(true);
    gamepadConnected.set(true);
    gamepadSnapshot.set({ axes: [0, 0, 0, 0], buttons: [] });

    expect(service.enable()).toBe(true);

    gamepadSnapshot.set({ axes: [0, 0], buttons: [] });
    vi.advanceTimersByTime(20);

    expect(service.enabled()).toBe(true);
    expect(publishStop).toHaveBeenCalledOnce();
    expect(releaseDriverControl).not.toHaveBeenCalled();
  });

  it('disables Driver when the gamepad disconnects', () => {
    vi.useFakeTimers();
    rosConnected.set(true);
    gamepadConnected.set(true);
    gamepadSnapshot.set({ axes: [0, 0, 0, 0], buttons: [] });

    expect(service.enable()).toBe(true);

    gamepadConnected.set(false);
    vi.advanceTimersByTime(20);

    expect(service.enabled()).toBe(false);
    expect(releaseDriverControl).toHaveBeenCalledOnce();
  });

  it('disables Driver when ROS disconnects', () => {
    vi.useFakeTimers();
    rosConnected.set(true);
    gamepadConnected.set(true);
    gamepadSnapshot.set({ axes: [0, 0, 0, 0], buttons: [] });

    expect(service.enable()).toBe(true);

    rosConnected.set(false);
    vi.advanceTimersByTime(20);

    expect(service.enabled()).toBe(false);
    expect(releaseDriverControl).toHaveBeenCalledOnce();
  });
});
