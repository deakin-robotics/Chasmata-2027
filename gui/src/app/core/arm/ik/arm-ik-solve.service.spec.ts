import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';

import { ArmClosedChainIkProvider } from './providers/arm-closed-chain-ik-provider';
import { ArmIkExecutionStatus, ArmIkPose } from './arm-ik-types';
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
    j4PivotPose: ReturnType<typeof vi.fn>;
    setJointAngles: ReturnType<typeof vi.fn>;
    solve: ReturnType<typeof vi.fn>;
  };
  let moveItProvider: {
    solve: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    executionStatus: ReturnType<typeof signal<ArmIkExecutionStatus>>;
  };

  beforeEach(() => {
    closedChainProvider = {
      load: vi.fn().mockResolvedValue(undefined),
      endEffectorPose: vi.fn().mockReturnValue(target),
      j4PivotPose: vi.fn().mockReturnValue(target),
      setJointAngles: vi.fn(),
      solve: vi.fn().mockReturnValue(convergedResult),
    };
    moveItProvider = {
      solve: vi.fn().mockReturnValue(convergedResult),
      reset: vi.fn(),
      executionStatus: signal<ArmIkExecutionStatus>('idle'),
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

  it('coalesces MoveIt2 targets and dispatches at most every 500 ms', async () => {
    vi.useFakeTimers();

    const firstResult = service.solve(target);
    vi.advanceTimersByTime(0);

    const secondResult = service.solve({ ...target, position: [0.3, 0.1, 0.3] });
    const latestResult = service.solve({ ...target, position: [0.4, 0.1, 0.3] });

    await expect(firstResult).resolves.toBeNull();
    await expect(secondResult).resolves.toBeNull();
    expect(moveItProvider.solve).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(499);
    expect(moveItProvider.solve).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(moveItProvider.solve).toHaveBeenCalledTimes(2);
    expect(moveItProvider.solve).toHaveBeenLastCalledWith({
      ...target,
      position: [0.4, 0.1, 0.3],
    });

    await expect(latestResult).resolves.toEqual(convergedResult);
  });

  it('keeps the in-house IK provider immediate', () => {
    vi.useFakeTimers();
    service.setProvider('closed-chain-ik');

    service.solve(target);
    vi.advanceTimersByTime(0);
    service.solve({ ...target, position: [0.3, 0.1, 0.3] });
    vi.advanceTimersByTime(0);

    expect(closedChainProvider.solve).toHaveBeenCalledTimes(2);
  });

  it('exposes MoveIt2 execution status only for the selected provider', () => {
    moveItProvider.executionStatus.set('executing');
    expect(service.executionStatus()).toBe('executing');

    service.setProvider('closed-chain-ik');

    expect(service.executionStatus()).toBe('idle');
  });

  it('loads the URDF and returns the initial J4 pivot pose for MoveIt2', async () => {
    const pose = await service.load('/test-arm.urdf');

    expect(closedChainProvider.load).toHaveBeenCalledWith('/test-arm.urdf');
    expect(closedChainProvider.j4PivotPose).toHaveBeenCalled();
    expect(pose).toEqual(target);
  });

  it('returns the end-effector pose for the in-house provider', async () => {
    service.setProvider('closed-chain-ik');

    const pose = await service.load('/test-arm.urdf');

    expect(closedChainProvider.endEffectorPose).toHaveBeenCalled();
    expect(pose).toEqual(target);
  });

  it('delegates telemetry forward kinematics for orientation capture', () => {
    const jointAngles = { base_joint: 0.1 };

    expect(service.poseFromJointAngles(jointAngles)).toEqual(target);
    expect(closedChainProvider.setJointAngles).toHaveBeenCalledWith(jointAngles);
    expect(closedChainProvider.endEffectorPose).toHaveBeenCalled();
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

  it('cancels scheduled MoveIt2 work when reset or switching providers', async () => {
    vi.useFakeTimers();

    const resetResult = service.solve(target);
    service.reset();
    vi.advanceTimersByTime(500);

    await expect(resetResult).resolves.toBeNull();
    expect(moveItProvider.solve).not.toHaveBeenCalled();

    const moveItResult = service.solve(target);
    vi.advanceTimersByTime(0);
    const scheduledResult = service.solve({ ...target, position: [0.3, 0.1, 0.3] });
    service.setProvider('closed-chain-ik');
    vi.advanceTimersByTime(500);

    await expect(moveItResult).resolves.toBeNull();
    await expect(scheduledResult).resolves.toBeNull();
    expect(moveItProvider.solve).toHaveBeenCalledTimes(1);

    const closedChainResult = service.solve(target);
    vi.advanceTimersByTime(0);
    await expect(closedChainResult).resolves.toEqual(convergedResult);
    expect(closedChainProvider.solve).toHaveBeenCalledWith(target);
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
