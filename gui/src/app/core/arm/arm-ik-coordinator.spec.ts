import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { ArmIkSolver } from './arm-ik-solver';
import { ArmIkCoordinator } from './arm-ik-coordinator';

describe('ArmIkCoordinator', () => {
  let coordinator: ArmIkCoordinator;
  let solver: {
    load: ReturnType<typeof vi.fn>;
    endEffectorPose: ReturnType<typeof vi.fn>;
    solve: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    solver = {
      load: vi.fn().mockResolvedValue(undefined),
      endEffectorPose: vi.fn().mockReturnValue({
        position: [0, 0, 0],
        orientation: [0, 0, 0, 1],
      }),
      solve: vi.fn().mockReturnValue({
        status: 'converged',
        jointAngles: { base_joint: 0 },
      }),
    };

    TestBed.configureTestingModule({
      providers: [{ provide: ArmIkSolver, useValue: solver }],
    });
    coordinator = TestBed.inject(ArmIkCoordinator);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with a neutral target and no solve result', () => {
    expect(coordinator.position()).toEqual([0, 0, 0]);
    expect(coordinator.status()).toBe('idle');
    expect(coordinator.jointAngles()).toBeNull();
  });

  it('stores and translates a valid target position', () => {
    coordinator.setPosition([0.2, 0.3, 0.4]);
    coordinator.translate([0.1, -0.1, 0.05]);

    const position = coordinator.position();
    expect(position[0]).toBeCloseTo(0.3);
    expect(position[1]).toBeCloseTo(0.2);
    expect(position[2]).toBeCloseTo(0.45);
  });

  it('rejects non-finite target positions', () => {
    expect(() => coordinator.setPosition([0, Number.NaN, 0])).toThrow(
      'The arm position target must contain three finite coordinates.',
    );
  });

  it('exposes a valid result after the solver converges', async () => {
    vi.useFakeTimers();

    await coordinator.load();
    vi.runAllTimers();

    expect(solver.solve).toHaveBeenCalledWith({
      position: [0, 0, 0],
      orientation: [0, 0, 0, 1],
    });
    expect(coordinator.status()).toBe('valid');
    expect(coordinator.jointAngles()).toEqual({ base_joint: 0 });
  });

  it('reports an unsuccessful solve as unreachable', async () => {
    vi.useFakeTimers();
    solver.solve.mockReturnValue({ status: 'stalled', jointAngles: {} });

    await coordinator.load();
    vi.runAllTimers();

    expect(coordinator.status()).toBe('unreachable');
    expect(coordinator.jointAngles()).toBeNull();
  });
});
