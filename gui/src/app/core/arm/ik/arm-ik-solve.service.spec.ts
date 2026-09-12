import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';

import { ArmIkExecutionStatus, ArmIkPose } from './arm-ik-types';
import { ArmIkSolveService } from './arm-ik-solve.service';
import { ArmMoveItIkProvider } from './providers/arm-moveit-ik-provider';

const target: ArmIkPose = {
  position: [0.2, 0.1, 0.3],
  orientation: [0, 0, 0, 1],
};

const convergedResult = { status: 'converged' as const, jointAngles: {} };

describe('ArmIkSolveService', () => {
  let service: ArmIkSolveService;
  let moveItProvider: {
    solve: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    synchronizeOrientationLock: ReturnType<typeof vi.fn>;
    executionStatus: ReturnType<typeof signal<ArmIkExecutionStatus>>;
  };

  beforeEach(() => {
    moveItProvider = {
      solve: vi.fn().mockReturnValue(convergedResult),
      reset: vi.fn(),
      synchronizeOrientationLock: vi.fn(),
      executionStatus: signal<ArmIkExecutionStatus>('idle'),
    };

    TestBed.configureTestingModule({
      providers: [{ provide: ArmMoveItIkProvider, useValue: moveItProvider }],
    });
    service = TestBed.inject(ArmIkSolveService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('delegates the first request to MoveIt2 immediately', async () => {
    vi.useFakeTimers();

    const result = service.solve(target);
    vi.runAllTimers();

    await expect(result).resolves.toEqual(convergedResult);
    expect(moveItProvider.solve).toHaveBeenCalledWith(target);
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

  it('exposes MoveIt2 execution status', () => {
    moveItProvider.executionStatus.set('executing');
    expect(service.executionStatus()).toBe('executing');
  });

  it('loads the URDF without returning a default target pose', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => `
        <robot name="test">
          <link name="base_link" />
          <joint name="pivot_mount" type="fixed">
            <parent link="base_link" />
            <child link="j4_pivot_link" />
            <origin xyz="0.2 0.1 0.3" rpy="0 0 0" />
          </joint>
          <link name="j4_pivot_link" />
          <joint name="ee_mount" type="fixed">
            <parent link="j4_pivot_link" />
            <child link="ee_link" />
          </joint>
          <link name="ee_link" />
        </robot>`,
      }),
    );

    await expect(service.load('/test-arm.urdf')).resolves.toBe(true);
    expect(moveItProvider.synchronizeOrientationLock).toHaveBeenCalledWith(false);
    expect(moveItProvider.solve).not.toHaveBeenCalled();
  });

  it('resolves superseded requests as null', async () => {
    vi.useFakeTimers();
    let resolveFirst!: (result: typeof convergedResult) => void;
    moveItProvider.solve.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

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

  it('propagates MoveIt2 failures', async () => {
    vi.useFakeTimers();
    const failure = new Error('MoveIt2 failed');
    moveItProvider.solve.mockImplementation(() => {
      throw failure;
    });

    const result = service.solve(target);
    vi.runAllTimers();

    await expect(result).rejects.toBe(failure);
  });
});
