import { Service, inject } from '@angular/core';
import { Ros, Topic } from 'roslib';

import { ArmIkPose, ArmIkSolveResult } from '../arm-ik-types';
import type { ArmIkProvider } from '../arm-ik-coordinator';
import { RosConnection } from '../../../ros/ros-connection';

const MOVEIT_TARGET_TOPIC = '/arm/target_pose';
const MOVEIT_SOLUTION_TOPIC = '/arm/moveit/solution';
const POSE_STAMPED_MESSAGE_TYPE = 'geometry_msgs/PoseStamped';
const JOINT_STATE_MESSAGE_TYPE = 'sensor_msgs/JointState';
const MOVEIT_RESPONSE_TIMEOUT_MS = 7000;

interface JointStateMessage {
  name?: unknown;
  position?: unknown;
}

interface PendingRequest {
  readonly target: ArmIkPose;
  readonly resolve: (result: ArmIkSolveResult) => void;
  readonly reject: (error: Error) => void;
}

/** Adapts the base-station MoveIt2 target/solution topics to the IK contract. */
@Service()
export class ArmMoveItIkProvider implements ArmIkProvider {
  private readonly rosConnection = inject(RosConnection);

  private activeClient: Ros | null = null;
  private targetTopic: Topic | null = null;
  private solutionTopic: Topic | null = null;
  private activeRequest: PendingRequest | null = null;
  private queuedRequest: PendingRequest | null = null;
  private responseTimer: ReturnType<typeof setTimeout> | null = null;

  solve(target: ArmIkPose): Promise<ArmIkSolveResult> {
    this.assertFinitePose(target);

    return new Promise((resolve, reject) => {
      this.queuedRequest?.reject(new Error('The previous MoveIt2 target was superseded.'));
      this.queuedRequest = { target, resolve, reject };
      this.pumpRequest();
    });
  }

  reset(): void {
    this.clearResponseTimer();
    this.activeRequest?.reject(new Error('MoveIt2 solve was reset.'));
    this.queuedRequest?.reject(new Error('MoveIt2 solve was reset.'));
    this.activeRequest = null;
    this.queuedRequest = null;
    this.disposeTopics();
  }

  private pumpRequest(): void {
    if (this.activeRequest || !this.queuedRequest) return;

    const request = this.queuedRequest;
    this.queuedRequest = null;
    const topics = this.ensureTopics();
    if (!topics) {
      request.reject(new Error('Connect to ROSbridge before using MoveIt2.'));
      this.pumpRequest();
      return;
    }

    this.activeRequest = request;
    topics.target.publish(this.toPoseStamped(request.target));
    this.responseTimer = setTimeout(
      () => this.finishRequest(null, new Error('MoveIt2 did not return a solution in time.')),
      MOVEIT_RESPONSE_TIMEOUT_MS,
    );
  }

  private handleSolution(message: JointStateMessage): void {
    if (!this.activeRequest) return;

    const names = message.name;
    const positions = message.position;

    if (!Array.isArray(names) || !Array.isArray(positions)) {
      this.finishRequest(null, new Error('MoveIt2 returned an invalid joint solution.'));
      return;
    }

    if (
      names.length === 0 ||
      names.length !== positions.length ||
      !names.every((name): name is string => typeof name === 'string') ||
      !positions.every(
        (position): position is number =>
          typeof position === 'number' && Number.isFinite(position),
      )
    ) {
      this.finishRequest(null, new Error('MoveIt2 returned invalid joint values.'));
      return;
    }

    this.finishRequest(
      {
        status: 'converged',
        jointAngles: Object.fromEntries(
          names.map((name, index) => [name, positions[index]]),
        ),
      },
      null,
    );
  }

  private finishRequest(result: ArmIkSolveResult | null, error: Error | null): void {
    this.clearResponseTimer();

    const request = this.activeRequest;
    this.activeRequest = null;
    if (request) {
      if (error) request.reject(error);
      else if (result) request.resolve(result);
    }

    this.pumpRequest();
  }

  private ensureTopics(): { target: Topic; solution: Topic } | null {
    const client = this.rosConnection.client();
    if (!client || !this.rosConnection.isConnected()) return null;

    if (client === this.activeClient && this.targetTopic && this.solutionTopic) {
      return { target: this.targetTopic, solution: this.solutionTopic };
    }

    this.disposeTopics();
    this.activeClient = client;
    this.targetTopic = new Topic({
      ros: client,
      name: MOVEIT_TARGET_TOPIC,
      messageType: POSE_STAMPED_MESSAGE_TYPE,
    });
    this.solutionTopic = new Topic({
      ros: client,
      name: MOVEIT_SOLUTION_TOPIC,
      messageType: JOINT_STATE_MESSAGE_TYPE,
    });
    this.solutionTopic.subscribe((message) => this.handleSolution(message as JointStateMessage));

    return { target: this.targetTopic, solution: this.solutionTopic };
  }

  private disposeTopics(): void {
    this.solutionTopic?.unsubscribe();
    this.targetTopic = null;
    this.solutionTopic = null;
    this.activeClient = null;
  }

  private clearResponseTimer(): void {
    if (this.responseTimer === null) return;

    clearTimeout(this.responseTimer);
    this.responseTimer = null;
  }

  private toPoseStamped(target: ArmIkPose): Record<string, unknown> {
    return {
      header: {
        stamp: { sec: 0, nanosec: 0 },
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
