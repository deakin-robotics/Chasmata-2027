import { TestBed } from '@angular/core/testing';
import type { Ros } from 'roslib';
import { vi } from 'vitest';

import { RosConnection } from '../../../ros/ros-connection';
import { ArmMoveItIkProvider } from './arm-moveit-ik-provider';

const rosMocks = {
  handlers: new Map<string, (message: unknown) => void>(),
  sentMessages: [] as Record<string, unknown>[],
  rosClient: null as Ros | null,
};

function createRosClient(): Ros {
  const handlers = rosMocks.handlers;

  return {
    on: vi.fn((event: string, callback: (message: unknown) => void) => {
      handlers.set(event, callback);
    }),
    off: vi.fn((event: string, callback: (message: unknown) => void) => {
      if (handlers.get(event) === callback) handlers.delete(event);
    }),
    once: vi.fn(),
    callOnConnection: vi.fn((message: Record<string, unknown>) => {
      rosMocks.sentMessages.push(message);
    }),
  } as unknown as Ros;
}

function publishStatus(data: string): void {
  rosMocks.handlers.get('/arm/moveit/status')?.({
    op: 'publish',
    msg: { data },
  });
}

const target = {
  position: [0.2, 0.1, 0.3] as const,
  orientation: [0, 0, 0, 1] as const,
};

describe('ArmMoveItIkProvider', () => {
  let provider: ArmMoveItIkProvider;

  beforeEach(() => {
    rosMocks.handlers.clear();
    rosMocks.sentMessages.length = 0;
    rosMocks.rosClient = createRosClient();

    TestBed.configureTestingModule({
      providers: [
        ArmMoveItIkProvider,
        {
          provide: RosConnection,
          useValue: {
            client: () => rosMocks.rosClient,
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
    const targetMessage = rosMocks.sentMessages.find(
      (message) => message['op'] === 'publish' && message['topic'] === '/arm/target_pose',
    );

    expect(targetMessage?.['msg']).toEqual(expect.objectContaining({
      header: expect.objectContaining({
        stamp: { sec: 0, nanosec: 1 },
        frame_id: 'base_link',
      }),
      pose: expect.objectContaining({
        position: { x: 0.2, y: 0.1, z: 0.3 },
      }),
    }));

    publishStatus('{"request_id":1,"state":"PLANNING"}');
    expect(provider.executionStatus()).toBe('planning');
    publishStatus('{"request_id":1,"state":"EXECUTING"}');
    expect(provider.executionStatus()).toBe('executing');
    publishStatus('{"request_id":1,"state":"SUCCEEDED"}');

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

    publishStatus('{"request_id":2,"state":"SUCCEEDED"}');

    await expect(secondRequest).resolves.toEqual({
      status: 'converged',
      jointAngles: {},
    });
  });

  it('propagates a failed execution event', async () => {
    const request = provider.solve(target);

    publishStatus('{"request_id":1,"state":"FAILED","message":"path incomplete"}');

    await expect(request).rejects.toThrow('path incomplete');
    expect(provider.executionStatus()).toBe('failed');
  });
});
