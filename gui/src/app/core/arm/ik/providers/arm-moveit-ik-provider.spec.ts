import { TestBed } from '@angular/core/testing';
import { Topic } from 'roslib';
import { vi } from 'vitest';

import { RosConnection } from '../../../ros/ros-connection';
import { ArmMoveItIkProvider } from './arm-moveit-ik-provider';

const rosMocks = vi.hoisted(() => ({
  subscriptions: new Map<string, (message: unknown) => void>(),
  topics: new Map<string, {
    publish: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
  }>(),
}));

vi.mock('roslib', () => ({
  Ros: class {},
  Topic: vi.fn(function (this: unknown, options: { name: string }) {
    const topic = {
      publish: vi.fn(),
      unsubscribe: vi.fn(),
    };
    rosMocks.topics.set(options.name, topic);
    return {
      ...topic,
      subscribe: vi.fn((callback: (message: unknown) => void) => {
        rosMocks.subscriptions.set(options.name, callback);
      }),
    };
  }),
}));

const target = {
  position: [0.2, 0.1, 0.3] as const,
  orientation: [0, 0, 0, 1] as const,
};

describe('ArmMoveItIkProvider', () => {
  let provider: ArmMoveItIkProvider;

  beforeEach(() => {
    rosMocks.subscriptions.clear();
    rosMocks.topics.clear();

    TestBed.configureTestingModule({
      providers: [
        ArmMoveItIkProvider,
        {
          provide: RosConnection,
          useValue: {
            client: () => ({}),
            isConnected: () => true,
          },
        },
      ],
    });
    provider = TestBed.inject(ArmMoveItIkProvider);
  });

  afterEach(() => {
    provider.reset();
    vi.clearAllMocks();
  });

  it('publishes a target pose and resolves on a successful execution event', async () => {
    const request = provider.solve(target);
    const targetTopic = rosMocks.topics.get('/arm/target_pose');
    const statusCallback = rosMocks.subscriptions.get('/arm/moveit/status');

    expect(targetTopic?.publish).toHaveBeenCalledWith(expect.objectContaining({
      header: expect.objectContaining({
        stamp: { sec: 0, nanosec: 1 },
        frame_id: 'base_link',
      }),
      pose: expect.objectContaining({
        position: { x: 0.2, y: 0.1, z: 0.3 },
      }),
    }));

    statusCallback?.({ data: '{"request_id":1,"state":"PLANNING"}' });
    expect(provider.executionStatus()).toBe('planning');
    statusCallback?.({ data: '{"request_id":1,"state":"EXECUTING"}' });
    expect(provider.executionStatus()).toBe('executing');
    statusCallback?.({ data: '{"request_id":1,"state":"SUCCEEDED"}' });

    await expect(request).resolves.toEqual({
      status: 'converged',
      jointAngles: {},
    });
    expect(provider.executionStatus()).toBe('succeeded');
  });

  it('supersedes an active target and keeps the newest request', async () => {
    const firstRequest = provider.solve(target);
    const secondRequest = provider.solve({
      ...target,
      position: [0.3, 0.1, 0.3],
    });

    await expect(firstRequest).resolves.toBeNull();

    const statusCallback = rosMocks.subscriptions.get('/arm/moveit/status');
    statusCallback?.({ data: '{"request_id":2,"state":"SUCCEEDED"}' });

    await expect(secondRequest).resolves.toEqual({
      status: 'converged',
      jointAngles: {},
    });
  });

  it('propagates a failed execution event', async () => {
    const request = provider.solve(target);
    const statusCallback = rosMocks.subscriptions.get('/arm/moveit/status');

    statusCallback?.({
      data: '{"request_id":1,"state":"FAILED","message":"path incomplete"}',
    });

    await expect(request).rejects.toThrow('path incomplete');
    expect(provider.executionStatus()).toBe('failed');
  });
});
