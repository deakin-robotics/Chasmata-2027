import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { Ros } from 'roslib';

import { RosConnection } from '../ros/ros-connection';
import { ControlCommandPublisher } from './control-command-publisher';

const { sentMessages } = vi.hoisted(() => ({
  sentMessages: [] as Array<Record<string, unknown>>,
}));

describe('ControlCommandPublisher', () => {
  beforeEach(() => {
    sentMessages.length = 0;

    const connected = signal(true);
    const client = {
      callOnConnection: vi.fn((message: Record<string, unknown>) => {
        sentMessages.push(message);
      }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Ros;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: RosConnection,
          useValue: {
            isConnected: connected.asReadonly(),
            client: signal(client).asReadonly(),
          },
        },
      ],
    });
  });

  it('publishes Arm Override commands on its dedicated topic', () => {
    const publisher = TestBed.inject(ControlCommandPublisher);

    expect(publisher.enableArmOverride()).toBe(true);
    expect(publisher.disableArmOverride()).toBe(true);

    expect(sentMessages).toEqual([
      expect.objectContaining({
        op: 'advertise',
        topic: '/arm/override/request',
        type: 'std_msgs/String',
      }),
      expect.objectContaining({
        op: 'publish',
        topic: '/arm/override/request',
        msg: { data: 'ENABLE' },
      }),
      expect.objectContaining({
        op: 'publish',
        topic: '/arm/override/request',
        msg: { data: 'DISABLE' },
      }),
    ]);
    expect(sentMessages.some(({ topic }) => topic === '/fma/law/request')).toBe(false);
  });
});
