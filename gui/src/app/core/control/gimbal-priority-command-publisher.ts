import { Service, inject } from '@angular/core';
import { Ros, Topic } from 'roslib';

import { GimbalPriorityOwner } from '../fma/fma-state.service';
import { RosConnection } from '../ros/ros-connection';

// Temporary mock-rover contract until Control provides the production topic.
const GIMBAL_PRIORITY_REQUEST_TOPIC = '/fma/gimbal/request';
const STRING_MESSAGE_TYPE = 'std_msgs/String';

/** Publishes temporary Gimbal priority requests for mock-rover testing. */
@Service()
export class GimbalPriorityCommandPublisher {
  private readonly rosConnection = inject(RosConnection);

  private topic: Topic | null = null;
  private topicClient: Ros | null = null;

  publish(owner: GimbalPriorityOwner): boolean {
    const topic = this.getTopic();
    if (!topic) return false;

    topic.publish({ data: owner });
    return true;
  }

  private getTopic(): Topic | null {
    const client = this.rosConnection.client();
    if (!client || !this.rosConnection.isConnected()) return null;

    if (this.topic && this.topicClient === client) return this.topic;

    this.topicClient = client;
    this.topic = new Topic({
      ros: client,
      name: GIMBAL_PRIORITY_REQUEST_TOPIC,
      messageType: STRING_MESSAGE_TYPE,
    });

    return this.topic;
  }
}
