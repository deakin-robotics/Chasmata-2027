import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';

import { ArmIkCoordinator } from './arm-ik-coordinator';
import { ArmIkSolveService } from './arm-ik-solve.service';
import { ArmIkExecutionStatus } from './arm-ik-types';
import { ArmTelemetryService } from '../telemetry/arm-telemetry.service';

describe('ArmIkCoordinator', () => {
  let coordinator: ArmIkCoordinator;
  let solveService: {
    reset: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
    solve: ReturnType<typeof vi.fn>;
    poseFromJointAngles: ReturnType<typeof vi.fn>;
    executionStatus: ReturnType<typeof signal<ArmIkExecutionStatus>>;
  };

  beforeEach(() => {
    solveService = {
      reset: vi.fn(),
      load: vi.fn().mockResolvedValue({ position: [0, 0, 0], orientation: [0, 0, 0, 1] }),
      solve: vi.fn().mockResolvedValue({ status: 'converged', jointAngles: {} }),
      poseFromJointAngles: vi.fn().mockReturnValue({
        position: [0, 0, 0],
        orientation: [0, 0, 0, 1],
      }),
      executionStatus: signal<ArmIkExecutionStatus>('idle'),
    };

    TestBed.configureTestingModule({
      providers: [{ provide: ArmIkSolveService, useValue: solveService }],
    });
    coordinator = TestBed.inject(ArmIkCoordinator);
  });

  it('starts with a neutral target and MoveIt2 pivot frame', () => {
    expect(coordinator.position()).toEqual([0, 0, 0]);
    expect(coordinator.targetFrame()).toBe('j4_pivot_link');
    expect(coordinator.orientationMode()).toBe('unlocked');
    expect(coordinator.status()).toBe('idle');
  });

  it('stores and translates a valid target position', () => {
    coordinator.setPosition([0.2, 0.3, 0.4]);
    coordinator.translate([0.1, -0.1, 0.05]);

    const position = coordinator.position();
    expect(position[0]).toBeCloseTo(0.3);
    expect(position[1]).toBeCloseTo(0.2);
    expect(position[2]).toBeCloseTo(0.45);
  });

  it('defaults the target to the loaded J4 pivot pose', async () => {
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

  it('maps a converged MoveIt2 execution to valid GUI state', async () => {
    await coordinator.load();
    await Promise.resolve();

    expect(solveService.solve).toHaveBeenCalledWith({
      position: [0, 0, 0],
      orientation: [0, 0, 0, 1],
      orientationMode: 'unlocked',
    });
    expect(coordinator.status()).toBe('valid');
  });

  it('reports an unsuccessful solve as unreachable', async () => {
    solveService.solve.mockResolvedValue({ status: 'stalled', jointAngles: {} });

    await coordinator.load();
    await Promise.resolve();

    expect(coordinator.status()).toBe('unreachable');
  });

  it('reports a rejected solve as invalid', async () => {
    solveService.solve.mockRejectedValue(new Error('MoveIt2 failed'));

    await coordinator.load();
    await Promise.resolve();

    expect(coordinator.status()).toBe('invalid');
  });

  it('ignores a superseded solve without reporting it as invalid', async () => {
    solveService.solve.mockResolvedValue(null);

    await coordinator.load();
    await Promise.resolve();

    expect(coordinator.status()).toBe('solving');
    expect(coordinator.jointAngles()).toBeNull();
  });

  it('captures actual telemetry orientation when entering locked mode', async () => {
    const telemetry = TestBed.inject(ArmTelemetryService);
    telemetry.setJointState({
      names: [
        'base_joint',
        'shoulder_joint',
        'elbow_joint',
        'yaw_joint',
        'pitch_joint',
        'roll_joint',
      ],
      positions: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
    });

    await coordinator.load();

    expect(coordinator.setOrientationMode('locked')).toBe(true);
    expect(coordinator.orientationMode()).toBe('locked');
    expect(solveService.poseFromJointAngles).toHaveBeenCalledWith({
      base_joint: 0,
      shoulder_joint: 0.1,
      elbow_joint: 0.2,
      yaw_joint: 0.3,
      pitch_joint: 0.4,
      roll_joint: 0.5,
    });
    expect(solveService.solve).toHaveBeenLastCalledWith(expect.objectContaining({
      orientationMode: 'locked',
    }));
  });

  it('keeps the captured orientation fixed while locked', async () => {
    const telemetry = TestBed.inject(ArmTelemetryService);
    telemetry.setJointState({
      names: [
        'base_joint',
        'shoulder_joint',
        'elbow_joint',
        'yaw_joint',
        'pitch_joint',
        'roll_joint',
      ],
      positions: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
    });
    const capturedOrientation = [0.1, 0.2, 0.3, 0.9] as const;
    solveService.poseFromJointAngles.mockReturnValue({
      position: [0.2, 0.3, 0.4],
      orientation: capturedOrientation,
    });

    await coordinator.load();

    expect(coordinator.setOrientationMode('locked')).toBe(true);
    coordinator.setPosition([0.3, 0.4, 0.5]);

    expect(coordinator.orientation()).toEqual(capturedOrientation);
  });
});
