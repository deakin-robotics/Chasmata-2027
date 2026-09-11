import { TestBed } from '@angular/core/testing';

import { ControlModeService } from '../control-mode';
import { ArmCommandPublisher, ArmJoyCommand } from './arm-command-publisher';
import { GamepadSnapshot } from '../../gamepad/gamepad-input';

describe('ArmCommandPublisher', () => {
  let controlMode: ControlModeService;
  let service: ArmCommandPublisher;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    controlMode = TestBed.inject(ControlModeService);
    service = TestBed.inject(ArmCommandPublisher);
  });

  it('should not publish while Arm control is inactive', () => {
    expect(service.canPublish()).toBe(false);
    expect(service.publish({ axes: [0, 0, 0, 0], buttons: [] })).toBe(false);
  });

  it('should not publish clear faults while ROS is disconnected', () => {
    expect(service.publishClearFaults()).toBe(false);
  });

  it('should release Arm authority when stopping control', () => {
    controlMode.activate('arm');

    service.releaseArmControl();

    expect(controlMode.mode()).toBe('none');
  });

  it('maps Manual mode inputs to the expanded joint layout', () => {
    const toArmJoyCommand = (
      service as unknown as {
        toArmJoyCommand(snapshot: GamepadSnapshot): ArmJoyCommand;
      }
    ).toArmJoyCommand.bind(service);
    const snapshot: GamepadSnapshot = {
      axes: [0.1, 0.2, 0.3, 0.4],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 12 ? 1 : 0)),
    };

    const command = toArmJoyCommand(snapshot);

    expect(command.axes).toEqual([-0.3, -0.4, 0, 0, 1, 0, -0.1, -0.2, 0, 0]);
  });

  it('leaves D-pad X unused in Manual mode', () => {
    const toArmJoyCommand = (
      service as unknown as {
        toArmJoyCommand(snapshot: GamepadSnapshot): ArmJoyCommand;
      }
    ).toArmJoyCommand.bind(service);
    const snapshot: GamepadSnapshot = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 15 ? 1 : 0)),
    };

    expect(toArmJoyCommand(snapshot).axes.every((axis) => axis === 0)).toBe(true);
  });

  it('preserves the analogue trigger directions in Manual mode', () => {
    const toArmJoyCommand = (
      service as unknown as {
        toArmJoyCommand(snapshot: GamepadSnapshot): ArmJoyCommand;
      }
    ).toArmJoyCommand.bind(service);
    const leftTrigger: GamepadSnapshot = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 6 ? 1 : 0)),
    };
    const rightTrigger: GamepadSnapshot = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 7 ? 1 : 0)),
    };

    expect(toArmJoyCommand(leftTrigger).axes.slice(8)).toEqual([0, 1]);
    expect(toArmJoyCommand(rightTrigger).axes.slice(8)).toEqual([1, 0]);
  });

  it('switches the right stick to the existing Gimbal path while LB is held', () => {
    const toArmJoyCommand = (
      service as unknown as {
        toArmJoyCommand(snapshot: GamepadSnapshot): ArmJoyCommand;
      }
    ).toArmJoyCommand.bind(service);
    const snapshot: GamepadSnapshot = {
      axes: [0.1, 0.2, 0.3, 0.4],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 4 ? 1 : 0)),
    };

    expect(toArmJoyCommand(snapshot).axes).toEqual([0, 0, 0, -0.3, -0.4, 0, -0.1, -0.2, 0, 0]);
  });

  it('keeps Position-mode left-stick wrist input independent of Manual remapping', () => {
    const toPositionJoyCommand = (
      service as unknown as {
        toPositionJoyCommand(snapshot: GamepadSnapshot): ArmJoyCommand;
      }
    ).toPositionJoyCommand.bind(service);
    const snapshot: GamepadSnapshot = {
      axes: [0.1, 0.2, 0.3, 0.4],
      buttons: [],
    };

    expect(toPositionJoyCommand(snapshot).axes.slice(0, 2)).toEqual([-0.1, -0.2]);
  });

  it('does not forward L3 as the Position-mode clear-fault button', () => {
    const toPositionJoyCommand = (
      service as unknown as {
        toPositionJoyCommand(snapshot: GamepadSnapshot): ArmJoyCommand;
      }
    ).toPositionJoyCommand.bind(service);
    const snapshot: GamepadSnapshot = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, (_, index) =>
        index === 0 || index === 1 || index === 2 || index === 10 ? 1 : 0,
      ),
    };

    const command = toPositionJoyCommand(snapshot);

    expect(command.buttons[10]).toBe(0);
    expect(command.buttons[0]).toBe(1);
    expect(command.buttons[1]).toBe(1);
    expect(command.buttons[3]).toBe(1);
  });
});
