import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { ArmClosedChainIkProvider } from './providers/arm-closed-chain-ik-provider';
import { ArmIkPose } from './arm-ik-types';
import { ArmIkSolveService } from './arm-ik-solve.service';
import { ArmMoveItIkProvider } from './providers/arm-moveit-ik-provider';

const target: ArmIkPose = {
  position: [0.2, 0.1, 0.3],
  orientation: [0, 0, 0, 1],
};

const convergedResult = {
  status: 'converged' as const,
  jointAngles: { base_joint: 0.1 },
};

describe('ArmIkSolveService', () => {
  let service: ArmIkSolveService;
  let closedChainProvider: {
    load: ReturnType<typeof vi.fn>;
    endEffectorPose: ReturnType<typeof vi.fn>;
    solve: ReturnType<typeof vi.fn>;
  };
  let moveItProvider: {
    solve: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    closedChainProvider = {
      load: vi.fn().mockResolvedValue(undefined),
      endEffectorPose: vi.fn().mockReturnValue(target),
      solve: vi.fn().mockReturnValue(convergedResult),
    };
    moveItProvider = {
      solve: vi.fn().mockReturnValue(convergedResult),
      reset: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: ArmClosedChainIkProvider, useValue: closedChainProvider },
        { provide: ArmMoveItIkProvider, useValue: moveItProvider },
      ],
    });
    service = TestBed.inject(ArmIkSolveService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses MoveIt2 by default and delegates provider switching', async () => {
    vi.useFakeTimers();

    const moveItResult = service.solve(target);
    vi.runAllTimers();
    await expect(moveItResult).resolves.toEqual(convergedResult);
    expect(moveItProvider.solve).toHaveBeenCalledWith(target);

    service.setProvider('closed-chain-ik');
    expect(service.provider()).toBe('closed-chain-ik');
    expect(moveItProvider.reset).toHaveBeenCalled();

    const closedChainResult = service.solve(target);
    vi.runAllTimers();
    await expect(closedChainResult).resolves.toEqual(convergedResult);
    expect(closedChainProvider.solve).toHaveBeenCalledWith(target);
  });

  it('loads the URDF and returns the initial end-effector pose', async () => {
    const pose = await service.load('/test-arm.urdf');

    expect(closedChainProvider.load).toHaveBeenCalledWith('/test-arm.urdf');
    expect(closedChainProvider.endEffectorPose).toHaveBeenCalled();
    expect(pose).toEqual(target);
  });

  it('resolves a superseded request as null', async () => {
    vi.useFakeTimers();
    let resolveFirst!: (result: typeof convergedResult) => void;
    closedChainProvider.solve
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(convergedResult);
    service.setProvider('closed-chain-ik');

    const firstResult = service.solve(target);
    vi.runAllTimers();
    const secondResult = service.solve({ ...target, position: [0.3, 0.1, 0.3] });

    await expect(firstResult).resolves.toBeNull();
    vi.runAllTimers();
    await expect(secondResult).resolves.toEqual(convergedResult);

    resolveFirst(convergedResult);
  });

  it('resets pending work without reporting an error', async () => {
    vi.useFakeTimers();
    const pendingResult = service.solve(target);
    service.reset();

    await expect(pendingResult).resolves.toBeNull();
    expect(moveItProvider.reset).toHaveBeenCalled();
  });

  it('propagates provider failures', async () => {
    vi.useFakeTimers();
    const failure = new Error('IK failed');
    moveItProvider.solve.mockImplementation(() => {
      throw failure;
    });

    const result = service.solve(target);
    vi.runAllTimers();

    await expect(result).rejects.toBe(failure);
  });
});
