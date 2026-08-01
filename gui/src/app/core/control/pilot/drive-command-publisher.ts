import { Service, computed, inject } from '@angular/core';
import { Ros, Topic } from 'roslib';

import { RosConnection } from '../../ros/ros-connection';
import { ControlModeService } from '../control-mode';

export interface JoyCommand {
  axes: readonly number[];
  buttons: readonly number[];
}

const JOY_TOPIC = '/joy';
const JOY_MESSAGE_TYPE = 'sensor_msgs/Joy';
const MINIMUM_DRIVE_AXES = 4;
const STOP_COMMAND: JoyCommand = {
  axes: [0, 0, 0, 0],
  buttons: [],
};

/** Publishes safe drivetrain Joy commands while Pilot control is authorised. */
@Service()
export class DriveCommandPublisher {
  private readonly rosConnection = inject(RosConnection);
  private readonly controlMode = inject(ControlModeService);

  private joyTopic: Topic | null = null;
  private topicClient: Ros | null = null;

  readonly canPublish = computed(
    () => this.rosConnection.isConnected() && this.controlMode.isPilotActive(),
  );

  /** Publishes one Joy command when ROS is connected and Pilot control is active. */
  publish(command: JoyCommand): boolean {
    if (!this.canPublish() || !this.isValidCommand(command)) return false;

    const topic = this.getJoyTopic();
    if (!topic) return false;

    topic.publish(this.toJoyMessage(command));
    return true;
  }

  /** Sends a valid zeroed Joy command whenever the drivetrain must stop. */
  publishStop(): boolean {
    const topic = this.getJoyTopic();
    if (!topic) return false;

    topic.publish(this.toJoyMessage(STOP_COMMAND));
    return true;
  }

  /** Stops the drivetrain before releasing Pilot control authority. */
  releasePilotControl(): void {
    if (!this.controlMode.isPilotActive()) return;

    this.publishStop();
    this.controlMode.release();
  }

  private getJoyTopic(): Topic | null {
    const client = this.rosConnection.client();
    if (!client || !this.rosConnection.isConnected()) return null;

    if (this.joyTopic && this.topicClient === client) return this.joyTopic;

    this.topicClient = client;
    this.joyTopic = new Topic({
      ros: client,
      name: JOY_TOPIC,
      messageType: JOY_MESSAGE_TYPE,
    });

    return this.joyTopic;
  }

  private isValidCommand(command: JoyCommand): boolean {
    return (
      command.axes.length >= MINIMUM_DRIVE_AXES &&
      command.axes.every(Number.isFinite) &&
      command.buttons.every(Number.isFinite)
    );
  }

  private toJoyMessage(command: JoyCommand): Record<string, unknown> {
    return {
      header: {
        stamp: { sec: 0, nanosec: 0 },
        frame_id: '',
      },
      axes: [...command.axes],
      buttons: [...command.buttons],
    };
  }
}
