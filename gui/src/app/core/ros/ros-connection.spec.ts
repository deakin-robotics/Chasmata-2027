import { effect } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Ros, Topic } from 'roslib';

import { RosConnection } from './ros-connection';

describe('RosConnection', () => {
  let service: RosConnection;
  let heartbeats: Array<{ topic: Topic; callback: () => void }>;
  let unsubscribe: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    heartbeats = [];
    vi.spyOn(Ros.prototype, 'connect').mockResolvedValue(undefined);
    vi.spyOn(Ros.prototype, 'close').mockImplementation(() => {});
    vi.spyOn(Topic.prototype, 'subscribe').mockImplementation(function (this: Topic, callback) {
      heartbeats.push({ topic: this, callback: callback as () => void });
    });
    unsubscribe = vi.spyOn(Topic.prototype, 'unsubscribe').mockImplementation(() => {});
    TestBed.configureTestingModule({});
    service = TestBed.inject(RosConnection);
  });

  afterEach(() => {
    service.disconnect();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should start disconnected', () => {
    expect(service.status()).toBe('disconnected');
    expect(service.isConnected()).toBe(false);
    expect(service.client()).toBeNull();
  });

  it('should reject an empty endpoint without opening a connection', () => {
    service.connect('   ');

    expect(service.status()).toBe('error');
    expect(service.error()).toBe('A ROSbridge URL is required.');
    expect(service.client()).toBeNull();
  });

  it('should report an error when reconnecting before configuration', () => {
    service.reconnect();

    expect(service.status()).toBe('error');
    expect(service.error()).toBe('No ROSbridge URL has been configured.');
  });

  it('should return to a clean disconnected state', () => {
    service.connect('');
    service.disconnect();

    expect(service.status()).toBe('disconnected');
    expect(service.error()).toBeNull();
    expect(service.url()).toBeNull();
    expect(service.reconnectAttempt()).toBe(0);
  });

  it('waits for the first heartbeat, stays ready on repeats, and waits again after a timeout', () => {
    let readyTransitions = 0;
    TestBed.runInInjectionContext(() => effect(() => {
      if (service.isConnected()) readyTransitions += 1;
    }));
    TestBed.flushEffects();

    service.connect('ws://localhost:9090');
    const client = service.client()!;
    client.emit('connection', {} as never);

    expect(service.status()).toBe('waiting-for-rover');
    expect(service.isConnected()).toBe(false);
    expect(heartbeats[0].topic.ros).toBe(client);
    expect(heartbeats[0].topic.name).toBe('/rover/heartbeat');
    expect(heartbeats[0].topic.messageType).toBe('std_msgs/msg/Empty');
    vi.advanceTimersByTime(3_000);
    expect(service.status()).toBe('waiting-for-rover');

    heartbeats[0].callback();
    expect(service.isConnected()).toBe(true);
    TestBed.flushEffects();
    expect(readyTransitions).toBe(1);
    vi.advanceTimersByTime(2_000);
    heartbeats[0].callback();
    TestBed.flushEffects();
    expect(readyTransitions).toBe(1);
    vi.advanceTimersByTime(2_999);
    expect(service.isConnected()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(service.status()).toBe('waiting-for-rover');
    expect(service.client()).not.toBeNull();
    TestBed.flushEffects();

    heartbeats[0].callback();
    expect(service.isConnected()).toBe(true);
    TestBed.flushEffects();
    expect(readyTransitions).toBe(2);
  });

  it('cleans up the listener and timer on disconnect and reconnect', () => {
    service.connect('ws://localhost:9090');
    service.client()!.emit('connection', {} as never);
    const oldTopic = heartbeats[0];
    oldTopic.callback();

    service.reconnect();
    expect(unsubscribe.mock.contexts).toContain(oldTopic.topic);
    expect(service.isConnected()).toBe(false);
    service.client()!.emit('connection', {} as never);
    oldTopic.callback();
    expect(service.isConnected()).toBe(false);
    heartbeats[1].callback();
    expect(service.isConnected()).toBe(true);

    service.disconnect();
    expect(unsubscribe.mock.contexts).toContain(heartbeats[1].topic);
    vi.advanceTimersByTime(3_000);
    expect(service.status()).toBe('disconnected');
  });

  it('returns to waiting after a WebSocket close and requires a new heartbeat', () => {
    service.connect('ws://localhost:9090');
    const client = service.client()!;
    client.emit('connection', {} as never);
    heartbeats[0].callback();
    client.emit('close', {} as never);

    expect(service.status()).toBe('reconnecting');
    expect(service.isConnected()).toBe(false);
    expect(unsubscribe.mock.contexts).toContain(heartbeats[0].topic);
    vi.advanceTimersByTime(1_000);
    service.client()!.emit('connection', {} as never);
    expect(service.status()).toBe('waiting-for-rover');
    heartbeats[1].callback();
    expect(service.isConnected()).toBe(true);
  });
});
