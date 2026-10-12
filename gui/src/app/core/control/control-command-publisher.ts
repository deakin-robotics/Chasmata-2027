import { Service, inject } from '@angular/core';
import { Ros, Topic } from 'roslib';

import { RosConnection } from '../ros/ros-connection';
import { ArmOverrideCommand } from './arm/arm-override';
import { ArmControlMode } from './arm/arm-control-mode';
import { DriverControlMode } from './drive/drive-control-mode';

const DRIVE_MODE_REQUEST_TOPIC = '/fma/drive/request';
const ARM_MODE_REQUEST_TOPIC = '/fma/arm/request';
const ARM_OVERRIDE_REQUEST_TOPIC = '/arm/override/request';
const STRING_MESSAGE_TYPE = 'std_msgs/String';

/** Publishes GUI control commands to their rover-side control boundaries. */
@Service()
export class ControlCommandPublisher {
  private readonly rosConnection = inject(RosConnection);

  private driveTopic: Topic | null = null;
  private armTopic: Topic | null = null;
  private armOverrideTopic: Topic | null = null;
  private topicClient: Ros | null = null;

  /** Advertises the Driver mode-request topic before rover readiness is confirmed. */
  prepareDriveModeRequest(): void {
    this.getTopic('drive')?.advertise();
  }

  /** Advertises the Arm mode-request topic before rover readiness is confirmed. */
  prepareArmModeRequest(): void {
    this.getTopic('arm')?.advertise();
  }

  publishDriveMode(mode: DriverControlMode): boolean {
    if (!this.rosConnection.isConnected()) return false;

    const topic = this.getTopic('drive');
    if (!topic) return false;

    topic.publish({ data: mode });
    return true;
  }

  publishArmMode(mode: ArmControlMode): boolean {
    if (!this.rosConnection.isConnected()) return false;

    const topic = this.getTopic('arm');
    if (!topic) return false;

    topic.publish({ data: mode });
    return true;
  }

  enableArmOverride(): boolean {
    return this.publishArmOverrideCommand(ArmOverrideCommand.Enable);
  }

  disableArmOverride(): boolean {
    return this.publishArmOverrideCommand(ArmOverrideCommand.Disable);
  }

  private publishArmOverrideCommand(command: ArmOverrideCommand): boolean {
    if (!this.rosConnection.isConnected()) return false;

    const topic = this.getTopic('armOverride');
    if (!topic) return false;

    topic.publish({ data: command });
    return true;
  }

  private getTopic(kind: 'drive' | 'arm' | 'armOverride'): Topic | null {
    const client = this.rosConnection.client();
    if (!client) return null;

    if (client !== this.topicClient) {
      this.topicClient = client;
      this.driveTopic = null;
      this.armTopic = null;
      this.armOverrideTopic = null;
    }

    if (kind === 'drive') {
      this.driveTopic ??= new Topic({
        ros: client,
        name: DRIVE_MODE_REQUEST_TOPIC,
        messageType: STRING_MESSAGE_TYPE,
      });
      return this.driveTopic;
    }

    if (kind === 'arm') {
      this.armTopic ??= new Topic({
        ros: client,
        name: ARM_MODE_REQUEST_TOPIC,
        messageType: STRING_MESSAGE_TYPE,
        latch: true,
      });
      return this.armTopic;
    }

    this.armOverrideTopic ??= new Topic({
      ros: client,
      name: ARM_OVERRIDE_REQUEST_TOPIC,
      messageType: STRING_MESSAGE_TYPE,
    });
    return this.armOverrideTopic;
  }
}
