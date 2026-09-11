import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';

import { ArmIkCoordinator } from './arm-ik-coordinator';
import { ArmIkProviderName } from './arm-ik-coordinator';
import { ArmIkSolveService } from './arm-ik-solve.service';
import { ArmIkExecutionStatus } from './arm-ik-types';

describe('ArmIkCoordinator', () => {
  let coordinator: ArmIkCoordinator;
  let solveService: {
    provider: ReturnType<typeof signal<ArmIkProviderName>>;
    setProvider: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
    solve: ReturnType<typeof vi.fn>;
    executionStatus: ReturnType<typeof signal<ArmIkExecutionStatus>>;
  };

  beforeEach(() => {
    const provider = signal<ArmIkProviderName>('moveit2');
    solveService = {
      provider,
      setProvider: vi.fn((nextProvider: ArmIkProviderName) => provider.set(nextProvider)),
      reset: vi.fn(),
      load: vi.fn().mockResolvedValue(undefined),
      solve: vi.fn().mockResolvedValue({
        status: 'converged',
        jointAngles: { base_joint: 0 },
      }),
      executionStatus: signal<ArmIkExecutionStatus>('idle'),
    };

    solveService.load.mockResolvedValue({
        position: [0, 0, 0],
        orientation: [0, 0, 0, 1],
    });

    TestBed.configureTestingModule({
      providers: [{ provide: ArmIkSolveService, useValue: solveService }],
    });
    coordinator = TestBed.inject(ArmIkCoordinator);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with a neutral target and no solve result', () => {
    expect(coordinator.position()).toEqual([0, 0, 0]);
    expect(coordinator.provider()).toBe('moveit2');
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

  it('defaults the target to the loaded end-effector pose', async () => {
    solveService.load.mockResolvedValue({
      position: [0.25, 0.1, 0.4],
      orientation: [0, 0, 0, 1],
    });

    await coordinator.load();

    expect(coordinator.position()).toEqual([0.25, 0.1, 0.4]);
  });

  it('rejects non-finite target positions', () => {
    expect(() => coordinator.setPosition([0, Number.NaN, 0])).toThrow(
      'The arm position target must contain three finite coordinates.',
    );
  });

  it('exposes a valid result after the solver converges', async () => {
    coordinator.setProvider('closed-chain-ik');

    await coordinator.load();
    await Promise.resolve();

    expect(solveService.setProvider).toHaveBeenCalledWith('closed-chain-ik');
    expect(solveService.solve).toHaveBeenCalledWith({
      position: [0, 0, 0],
      orientation: [0, 0, 0, 1],
    });
    expect(coordinator.status()).toBe('valid');
    expect(coordinator.jointAngles()).toEqual({ base_joint: 0 });
  });

  it('reports an unsuccessful solve as unreachable', async () => {
    coordinator.setProvider('closed-chain-ik');
    solveService.solve.mockResolvedValue({ status: 'stalled', jointAngles: {} });

    await coordinator.load();
    await Promise.resolve();

    expect(coordinator.status()).toBe('unreachable');
    expect(coordinator.jointAngles()).toBeNull();
  });

  it('reports a rejected solve as invalid', async () => {
    solveService.solve.mockRejectedValue(new Error('IK provider failed'));

    await coordinator.load();
    await Promise.resolve();

    expect(coordinator.status()).toBe('invalid');
    expect(coordinator.jointAngles()).toBeNull();
  });
});
