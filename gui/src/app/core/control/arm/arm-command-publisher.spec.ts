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
