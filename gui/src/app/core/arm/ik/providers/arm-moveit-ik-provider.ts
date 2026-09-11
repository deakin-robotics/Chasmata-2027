import { Service, inject, signal } from '@angular/core';
import { Ros, Topic } from 'roslib';

import {
  ArmIkExecutionStatus,
  ArmIkPose,
  ArmIkSolveResult,
} from '../arm-ik-types';
import { RosConnection } from '../../../ros/ros-connection';

const MOVEIT_TARGET_TOPIC = '/arm/target_pose';
const MOVEIT_ORIENTATION_LOCK_TOPIC = '/arm/orientation_lock';
const MOVEIT_STATUS_TOPIC = '/arm/moveit/status';
const POSE_STAMPED_MESSAGE_TYPE = 'geometry_msgs/PoseStamped';
const BOOL_MESSAGE_TYPE = 'std_msgs/Bool';
const STRING_MESSAGE_TYPE = 'std_msgs/String';
const MOVEIT_RESPONSE_TIMEOUT_MS = 15_000;
const MOVEIT_LOG_PREFIX = '[MoveIt2]';

type MoveItStatus = 'PLANNING' | 'EXECUTING' | 'SUCCEEDED' | 'CANCELED' | 'FAILED';

interface StatusMessage {
  request_id?: unknown;
  state?: unknown;
  message?: unknown;
}

interface PendingRequest {
  readonly id: number;
  readonly target: ArmIkPose;
  readonly resolve: (result: ArmIkSolveResult | null) => void;
  readonly reject: (error: Error) => void;
}

/** Sends target poses to the base-station trajectory executor. */
@Service()
export class ArmMoveItIkProvider {
  private readonly rosConnection = inject(RosConnection);

  private readonly executionStatusState = signal<ArmIkExecutionStatus>('idle');
  readonly executionStatus = this.executionStatusState.asReadonly();

  private activeClient: Ros | null = null;
  private targetTopic: Topic | null = null;
  private orientationLockTopic: Topic | null = null;
  private statusTopic: Topic | null = null;
  private activeRequest: PendingRequest | null = null;
  private responseTimer: ReturnType<typeof setTimeout> | null = null;
  private requestSequence = 0;
  private activeStartedAt: number | null = null;

  solve(target: ArmIkPose): Promise<ArmIkSolveResult | null> {
    this.assertFinitePose(target);

    return new Promise((resolve, reject) => {
      const id = ++this.requestSequence;
      const topics = this.ensureTopics();

      if (!topics) {
        this.executionStatusState.set('failed');
        reject(new Error('Connect to ROSbridge before using MoveIt2.'));
        return;
      }

      if (this.activeRequest) {
        console.log(`${MOVEIT_LOG_PREFIX} target superseded`, {
          previousRequestId: this.activeRequest.id,
          requestId: id,
        });
        this.activeRequest.resolve(null);
      }

      const request: PendingRequest = { id, target, resolve, reject };
      this.activeRequest = request;
      this.activeStartedAt = performance.now();
      this.executionStatusState.set('planning');
      this.clearResponseTimer();

      try {
        topics.orientationLock.publish({ data: target.orientationMode === 'locked' });
        topics.target.publish(this.toPoseStamped(target, id));
        console.log(`${MOVEIT_LOG_PREFIX} target sent`, {
          requestId: id,
          topic: MOVEIT_TARGET_TOPIC,
          position: target.position,
          orientationMode: target.orientationMode ?? 'unlocked',
        });
      } catch (error) {
        this.finishRequest(null, this.toError(error, 'MoveIt2 target publish failed.'));
        return;
      }

      this.responseTimer = setTimeout(
        () => this.finishRequest(null, new Error('MoveIt2 did not finish the trajectory in time.')),
        MOVEIT_RESPONSE_TIMEOUT_MS,
      );
    });
  }

  reset(): void {
    console.log(`${MOVEIT_LOG_PREFIX} reset`);
    this.clearResponseTimer();
    this.activeStartedAt = null;
    this.activeRequest?.resolve(null);
    this.activeRequest = null;
    this.executionStatusState.set('idle');
    this.disposeTopics();
  }

  private handleStatus(message: StatusMessage): void {
    const request = this.activeRequest;
    const requestId = this.numberValue(message.request_id);
    const state = this.statusValue(message.state);
    if (!request || requestId !== request.id || !state) return;

    if (state === 'PLANNING') {
      this.executionStatusState.set('planning');
      return;
    }

    if (state === 'EXECUTING') {
      this.executionStatusState.set('executing');
      return;
    }

    if (state === 'CANCELED') {
      this.executionStatusState.set('canceled');
      this.finishRequest(null, null);
      return;
    }

    if (state === 'FAILED') {
      this.finishRequest(
        null,
        new Error(
          typeof message.message === 'string'
            ? message.message
            : 'MoveIt2 trajectory execution failed.',
        ),
      );
      return;
    }

    this.executionStatusState.set('succeeded');
    this.finishRequest({ status: 'converged', jointAngles: {} }, null);
  }

  private finishRequest(
    result: ArmIkSolveResult | null,
    error: Error | null,
  ): void {
    this.clearResponseTimer();

    const request = this.activeRequest;
    this.activeRequest = null;
    const elapsedMs = this.activeStartedAt === null
      ? null
      : Math.round(performance.now() - this.activeStartedAt);
    this.activeStartedAt = null;

    if (!request) return;

    if (error) {
      this.executionStatusState.set('failed');
      console.error(`${MOVEIT_LOG_PREFIX} request failed`, {
        requestId: request.id,
        elapsedMs,
        error: error.message,
      });
      request.reject(error);
      return;
    }

    if (result) {
      console.log(`${MOVEIT_LOG_PREFIX} trajectory completed`, {
        requestId: request.id,
        elapsedMs,
      });
      request.resolve(result);
      return;
    }

    request.resolve(null);
  }

  private ensureTopics(): { target: Topic; orientationLock: Topic; status: Topic } | null {
    const client = this.rosConnection.client();
    if (!client || !this.rosConnection.isConnected()) return null;

    if (
      client === this.activeClient &&
      this.targetTopic &&
      this.orientationLockTopic &&
      this.statusTopic
    ) {
      return {
        target: this.targetTopic,
        orientationLock: this.orientationLockTopic,
        status: this.statusTopic,
      };
    }

    this.disposeTopics();
    this.activeClient = client;
    this.targetTopic = new Topic({
      ros: client,
      name: MOVEIT_TARGET_TOPIC,
      messageType: POSE_STAMPED_MESSAGE_TYPE,
    });
    this.orientationLockTopic = new Topic({
      ros: client,
      name: MOVEIT_ORIENTATION_LOCK_TOPIC,
      messageType: BOOL_MESSAGE_TYPE,
    });
    this.statusTopic = new Topic({
      ros: client,
      name: MOVEIT_STATUS_TOPIC,
      messageType: STRING_MESSAGE_TYPE,
    });
    this.statusTopic.subscribe((message) => this.handleStatusMessage(message));

    return {
      target: this.targetTopic,
      orientationLock: this.orientationLockTopic,
      status: this.statusTopic,
    };
  }

  private handleStatusMessage(message: unknown): void {
    if (!message || typeof message !== 'object' || !('data' in message)) return;

    const data = (message as { data?: unknown }).data;
    if (typeof data !== 'string') return;

    try {
      this.handleStatus(JSON.parse(data) as StatusMessage);
    } catch {
      console.warn(`${MOVEIT_LOG_PREFIX} ignored malformed status message`);
    }
  }

  private disposeTopics(): void {
    this.statusTopic?.unsubscribe();
    this.targetTopic = null;
    this.orientationLockTopic = null;
    this.statusTopic = null;
    this.activeClient = null;
  }

  private clearResponseTimer(): void {
    if (this.responseTimer === null) return;

    clearTimeout(this.responseTimer);
    this.responseTimer = null;
  }

  private toPoseStamped(target: ArmIkPose, requestId: number): Record<string, unknown> {
    return {
      header: {
        stamp: {
          sec: Math.floor(requestId / 1_000_000_000),
          nanosec: requestId % 1_000_000_000,
        },
        frame_id: 'base_link',
      },
      pose: {
        position: {
          x: target.position[0],
          y: target.position[1],
          z: target.position[2],
        },
        orientation: {
          x: target.orientation[0],
          y: target.orientation[1],
          z: target.orientation[2],
          w: target.orientation[3],
        },
      },
    };
  }

  private statusValue(value: unknown): MoveItStatus | null {
    return value === 'PLANNING' ||
      value === 'EXECUTING' ||
      value === 'SUCCEEDED' ||
      value === 'CANCELED' ||
      value === 'FAILED'
      ? value
      : null;
  }

  private numberValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
  }

  private toError(error: unknown, fallback: string): Error {
    return error instanceof Error ? error : new Error(fallback);
  }

  private assertFinitePose(target: ArmIkPose): void {
    if (
      target.position.length !== 3 ||
      target.orientation.length !== 4 ||
      [...target.position, ...target.orientation].some((value) => !Number.isFinite(value))
    ) {
      throw new Error('The MoveIt2 target pose must contain finite numbers.');
    }
  }
}
