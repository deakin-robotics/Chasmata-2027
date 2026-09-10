import { Service, inject } from '@angular/core';
import { Ros, Topic } from 'roslib';

import { RosConnection } from '../ros/ros-connection';
import { ArmControlMode } from './arm/arm-control-mode';
import { DriverControlMode } from './drive/drive-control-mode';

const DRIVE_MODE_REQUEST_TOPIC = '/fma/drive/request';
const ARM_MODE_REQUEST_TOPIC = '/fma/arm/request';
const STRING_MESSAGE_TYPE = 'std_msgs/String';

/** Publishes local mode requests to the rover-side control boundary. */
@Service()
export class ControlModeCommandPublisher {
  private readonly rosConnection = inject(RosConnection);

  private driveTopic: Topic | null = null;
  private armTopic: Topic | null = null;
  private topicClient: Ros | null = null;

  publishDriveMode(mode: DriverControlMode): boolean {
    const topic = this.getTopic('drive');
    if (!topic) return false;

    topic.publish({ data: mode });
    return true;
  }

  publishArmMode(mode: ArmControlMode): boolean {
    const topic = this.getTopic('arm');
    if (!topic) return false;

    topic.publish({ data: mode });
    return true;
  }

  private getTopic(kind: 'drive' | 'arm'): Topic | null {
    const client = this.rosConnection.client();
    if (!client || !this.rosConnection.isConnected()) return null;

    if (client !== this.topicClient) {
      this.topicClient = client;
      this.driveTopic = null;
      this.armTopic = null;
    }

    if (kind === 'drive') {
      this.driveTopic ??= new Topic({
        ros: client,
        name: DRIVE_MODE_REQUEST_TOPIC,
        messageType: STRING_MESSAGE_TYPE,
      });
      return this.driveTopic;
    }

    this.armTopic ??= new Topic({
      ros: client,
      name: ARM_MODE_REQUEST_TOPIC,
      messageType: STRING_MESSAGE_TYPE,
    });
    return this.armTopic;
  }
}
