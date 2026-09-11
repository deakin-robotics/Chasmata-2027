import { Service, computed, inject } from '@angular/core';
import URDFLoader from 'urdf-loader';
import * as Three from 'three';

import { ArmMoveItIkProvider } from './providers/arm-moveit-ik-provider';
import { ArmIkExecutionStatus, ArmIkPose, ArmIkSolveResult } from './arm-ik-types';

interface PendingSolve {
  readonly request: number;
  readonly target: ArmIkPose;
  readonly resolve: (result: ArmIkSolveResult | null) => void;
  readonly reject: (error: unknown) => void;
}

const MOVEIT_REQUEST_INTERVAL_MS = 500;
export const DEFAULT_ARM_URDF_URL = '/assets/kinematics/arm.urdf';
const J4_PIVOT_LINK = 'j4_pivot_link';
const END_EFFECTOR_LINK = 'ee_link';

type LoadedRobot = ReturnType<URDFLoader['parse']>;

/** Owns MoveIt2 execution scheduling and the browser's FK-only display model. */
@Service()
export class ArmIkSolveService {
  private readonly armMoveItIkProvider = inject(ArmMoveItIkProvider);
  private readonly loader = new URDFLoader();
  private model: LoadedRobot | null = null;
  private solveRequest = 0;
  private loadRequest = 0;
  private solveTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedSolve: PendingSolve | null = null;
  private activeSolve: PendingSolve | null = null;
  private lastMoveItDispatchAtMs: number | null = null;

  readonly executionStatus = computed<ArmIkExecutionStatus>(() =>
    this.armMoveItIkProvider.executionStatus(),
  );

  async load(url = DEFAULT_ARM_URDF_URL): Promise<boolean> {
    const request = ++this.loadRequest;
    this.resetSolveWork();

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Unable to load arm URDF: ${url}`);
      this.model = this.loader.parse(await response.text());
    } catch (error) {
      if (request !== this.loadRequest) return false;
      throw error;
    }

    return request === this.loadRequest;
  }

  /** Returns a forward-kinematics pose for actual rover joint telemetry. */
  poseFromJointAngles(jointAngles: Readonly<Record<string, number>>): ArmIkPose | null {
    const model = this.model;
    if (!model) return null;

    for (const [name, angle] of Object.entries(jointAngles)) {
      if (Number.isFinite(angle) && model.joints[name]) model.setJointValue(name, angle);
    }

    return this.j4PivotPose();
  }

  solve(target: ArmIkPose): Promise<ArmIkSolveResult | null> {
    const request = ++this.solveRequest;

    this.queuedSolve?.resolve(null);
    this.activeSolve?.resolve(null);
    this.queuedSolve = null;
    this.activeSolve = null;
    this.clearSolveTimer();

    return new Promise<ArmIkSolveResult | null>((resolve, reject) => {
      this.queuedSolve = { request, target, resolve, reject };
      this.scheduleQueuedSolve();
    });
  }

  reset(): void {
    this.loadRequest += 1;
    this.resetSolveWork();
  }

  private resetSolveWork(): void {
    this.solveRequest += 1;
    this.clearSolveTimer();
    this.queuedSolve?.resolve(null);
    this.activeSolve?.resolve(null);
    this.queuedSolve = null;
    this.activeSolve = null;
    this.lastMoveItDispatchAtMs = null;
    this.armMoveItIkProvider.reset?.();
  }

  private scheduleQueuedSolve(): void {
    const delay = this.moveItDispatchDelayMs();

    this.solveTimer = setTimeout(() => this.startQueuedSolve(), delay);
  }

  private moveItDispatchDelayMs(): number {
    if (this.lastMoveItDispatchAtMs === null) return 0;

    return Math.max(MOVEIT_REQUEST_INTERVAL_MS - (Date.now() - this.lastMoveItDispatchAtMs), 0);
  }

  private startQueuedSolve(): void {
    this.solveTimer = null;

    const solve = this.queuedSolve;
    this.queuedSolve = null;
    if (!solve || solve.request !== this.solveRequest) {
      solve?.resolve(null);
      return;
    }

    this.activeSolve = solve;
    this.lastMoveItDispatchAtMs = Date.now();

    let result: ArmIkSolveResult | null | Promise<ArmIkSolveResult | null>;
    try {
      result = this.armMoveItIkProvider.solve(solve.target);
    } catch (error) {
      this.finishSolve(solve, null, error);
      return;
    }

    Promise.resolve(result).then(
      (solveResult) => this.finishSolve(solve, solveResult, null),
      (error) => this.finishSolve(solve, null, error),
    );
  }

  private finishSolve(solve: PendingSolve, result: ArmIkSolveResult | null, error: unknown): void {
    if (this.activeSolve !== solve) return;

    this.activeSolve = null;
    if (error !== null) solve.reject(error);
    else if (solve.request === this.solveRequest) solve.resolve(result);
    else solve.resolve(null);
  }

  private clearSolveTimer(): void {
    if (this.solveTimer === null) return;

    clearTimeout(this.solveTimer);
    this.solveTimer = null;
  }

  private j4PivotPose(): ArmIkPose {
    const model = this.model;
    if (!model) throw new Error('Load the arm URDF before using the MoveIt2 model.');

    const pivot = model.links[J4_PIVOT_LINK];
    const endEffector = model.links[END_EFFECTOR_LINK];
    if (!pivot || !endEffector) {
      throw new Error(`The arm URDF must contain ${J4_PIVOT_LINK} and ${END_EFFECTOR_LINK}.`);
    }

    model.updateMatrixWorld(true);
    const pivotPosition = new Three.Vector3();
    const endEffectorOrientation = new Three.Quaternion();
    pivot.getWorldPosition(pivotPosition);
    endEffector.getWorldQuaternion(endEffectorOrientation);

    return {
      position: [pivotPosition.x, pivotPosition.y, pivotPosition.z],
      orientation: [
        endEffectorOrientation.x,
        endEffectorOrientation.y,
        endEffectorOrientation.z,
        endEffectorOrientation.w,
      ],
      orientationMode: 'unlocked',
    };
  }
}
