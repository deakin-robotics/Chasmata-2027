import { Service, computed, inject, signal } from '@angular/core';

import {
  ArmClosedChainIkProvider,
  DEFAULT_ARM_URDF_URL,
} from './providers/arm-closed-chain-ik-provider';
import { ArmMoveItIkProvider } from './providers/arm-moveit-ik-provider';
import { ArmIkExecutionStatus, ArmIkPose, ArmIkSolveResult } from './arm-ik-types';
import type { ArmIkProvider, ArmIkProviderName } from './arm-ik-coordinator';

interface PendingSolve {
  readonly request: number;
  readonly target: ArmIkPose;
  readonly resolve: (result: ArmIkSolveResult | null) => void;
  readonly reject: (error: unknown) => void;
}

const MOVEIT_REQUEST_INTERVAL_MS = 500;

/** Owns provider selection, model loading, scheduling, and IK execution. */
@Service()
export class ArmIkSolveService {
  private readonly armClosedChainIkProvider = inject(ArmClosedChainIkProvider);
  private readonly armMoveItIkProvider = inject(ArmMoveItIkProvider);

  private readonly providerState = signal<ArmIkProviderName>('moveit2');
  private solveRequest = 0;
  private loadRequest = 0;
  private solveTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedSolve: PendingSolve | null = null;
  private activeSolve: PendingSolve | null = null;
  private lastMoveItDispatchAtMs: number | null = null;

  readonly provider = this.providerState.asReadonly();
  readonly executionStatus = computed<ArmIkExecutionStatus>(() =>
    this.providerState() === 'moveit2'
      ? this.armMoveItIkProvider.executionStatus()
      : 'idle',
  );

  setProvider(provider: ArmIkProviderName): void {
    if (provider === this.providerState()) return;

    this.reset();
    this.providerState.set(provider);
  }

  async load(url = DEFAULT_ARM_URDF_URL): Promise<ArmIkPose | null> {
    const request = ++this.loadRequest;
    this.resetSolveWork();

    try {
      await this.armClosedChainIkProvider.load(url);
    } catch (error) {
      if (request !== this.loadRequest) return null;
      throw error;
    }

    if (request !== this.loadRequest) return null;
    return this.armClosedChainIkProvider.endEffectorPose();
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
    const delay = this.providerState() === 'moveit2'
      ? this.moveItDispatchDelayMs()
      : 0;

    this.solveTimer = setTimeout(() => this.startQueuedSolve(), delay);
  }

  private moveItDispatchDelayMs(): number {
    if (this.lastMoveItDispatchAtMs === null) return 0;

    return Math.max(
      MOVEIT_REQUEST_INTERVAL_MS - (Date.now() - this.lastMoveItDispatchAtMs),
      0,
    );
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
    if (this.providerState() === 'moveit2') {
      this.lastMoveItDispatchAtMs = Date.now();
    }

    let result: ArmIkSolveResult | null | Promise<ArmIkSolveResult | null>;
    try {
      result = this.selectedProvider().solve(solve.target);
    } catch (error) {
      this.finishSolve(solve, null, error);
      return;
    }

    Promise.resolve(result).then(
      (solveResult) => this.finishSolve(solve, solveResult, null),
      (error) => this.finishSolve(solve, null, error),
    );
  }

  private finishSolve(
    solve: PendingSolve,
    result: ArmIkSolveResult | null,
    error: unknown,
  ): void {
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

  private selectedProvider(): ArmIkProvider {
    return this.providerState() === 'moveit2'
      ? this.armMoveItIkProvider
      : this.armClosedChainIkProvider;
  }
}
