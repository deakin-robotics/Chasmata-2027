import { TestBed } from '@angular/core/testing';

import { ArmMode } from '../../fma/fma-state.service';
import { ArmManualControl } from './arm-manual-control';
import { ArmControlModeService } from './arm-control-mode';
import { ArmPositionControl } from './arm-position-control';

describe('ArmControlModeService', () => {
  let service: ArmControlModeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
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
});
