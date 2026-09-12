import { TestBed } from '@angular/core/testing';

import { ControlModeService } from '../control-mode';
import { ArmCommandPublisher } from './arm-command-publisher';
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

  it('builds shared digital buttons and analogue trigger fields', () => {
    const snapshot: GamepadSnapshot = {
      axes: [],
      buttons: Array.from({ length: 16 }, (_, index) => (index <= 11 ? 1 : 0)),
    };

    const command = service.createCommand(snapshot, [0.1, 0.2, 0.3, 0.4]);

    expect(command.axes).toEqual([0.1, 0.2, 0.3, 0.4, 0, 0, 0, 0, 1, 1]);
    expect(command.buttons).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1]);
  });

  it('can omit triggers for a zeroed Position-mode command', () => {
    const snapshot: GamepadSnapshot = {
      axes: [],
      buttons: Array.from({ length: 16 }, (_, index) => (index === 6 || index === 7 ? 1 : 0)),
    };

    const command = service.createCommand(snapshot, new Array(10).fill(0), {
      includeTriggers: false,
    });

    expect(command.axes.slice(8)).toEqual([0, 0]);
  });
});
