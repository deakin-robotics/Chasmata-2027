import { effect } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Ros, Topic } from 'roslib';

import { RosConnection } from './ros-connection';
import { RosHeartbeatMonitor } from './ros-heartbeat-monitor';

describe('RosConnection and RosHeartbeatMonitor', () => {
  let service: RosConnection;
  let heartbeatMonitor: RosHeartbeatMonitor;
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
    heartbeatMonitor = TestBed.inject(RosHeartbeatMonitor);
    TestBed.flushEffects();
  });

  afterEach(() => {
    service.disconnect();
    TestBed.flushEffects();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('starts disconnected and with both heartbeats unavailable', () => {
    expect(service.status()).toBe('disconnected');
    expect(service.isConnected()).toBe(false);
    expect(service.client()).toBeNull();
    expect(heartbeatMonitor.roverAvailable()).toBe(false);
    expect(heartbeatMonitor.baseStationAvailable()).toBe(false);
  });

  it('rejects an empty endpoint without opening a connection', () => {
    service.connect('   ');

    expect(service.status()).toBe('error');
    expect(service.error()).toBe('A ROSbridge URL is required.');
    expect(service.client()).toBeNull();
  });

  it('reports an error when reconnecting before configuration', () => {
    service.reconnect();

    expect(service.status()).toBe('error');
    expect(service.error()).toBe('No ROSbridge URL has been configured.');
  });

  it('returns to a clean disconnected state', () => {
    service.connect('');
    service.disconnect();

    expect(service.status()).toBe('disconnected');
    expect(service.error()).toBeNull();
    expect(service.url()).toBeNull();
    expect(service.reconnectAttempt()).toBe(0);
  });

  it('tracks rover and base-station heartbeats independently', () => {
    let roverReadyTransitions = 0;
    TestBed.runInInjectionContext(() => effect(() => {
      if (heartbeatMonitor.roverAvailable()) roverReadyTransitions += 1;
    }));
    TestBed.flushEffects();

    service.connect('ws://localhost:9090');
    const client = service.client()!;
    TestBed.flushEffects();
    client.emit('connection', {} as never);

    expect(service.status()).toBe('connected');
    expect(service.isConnected()).toBe(true);
    expect(heartbeatMonitor.roverStatus()).toBe('waiting-for-rover');
    expect(heartbeats).toHaveLength(2);
    expect(heartbeats[0].topic.ros).toBe(client);
    expect(heartbeats[0].topic.name).toBe('/rover/heartbeat');
    expect(heartbeats[0].topic.messageType).toBe('std_msgs/msg/Empty');
    expect(heartbeats[1].topic.ros).toBe(client);
    expect(heartbeats[1].topic.name).toBe('/basestation/heartbeat');
    expect(heartbeats[1].topic.messageType).toBe('std_msgs/msg/Empty');

    heartbeats[0].callback();
    expect(heartbeatMonitor.roverAvailable()).toBe(true);
    expect(heartbeatMonitor.baseStationAvailable()).toBe(false);
    expect(heartbeatMonitor.roverStatus()).toBe('connected');
    TestBed.flushEffects();
    expect(roverReadyTransitions).toBe(1);

    heartbeats[1].callback();
    expect(heartbeatMonitor.baseStationAvailable()).toBe(true);
    vi.advanceTimersByTime(2_000);
    heartbeats[0].callback();
    vi.advanceTimersByTime(1_000);

    expect(heartbeatMonitor.roverAvailable()).toBe(true);
    expect(heartbeatMonitor.baseStationAvailable()).toBe(false);

    vi.advanceTimersByTime(2_000);
    expect(heartbeatMonitor.roverAvailable()).toBe(false);
    expect(heartbeatMonitor.roverStatus()).toBe('waiting-for-rover');
    expect(service.client()).not.toBeNull();
    TestBed.flushEffects();

    heartbeats[0].callback();
    expect(heartbeatMonitor.roverAvailable()).toBe(true);
    TestBed.flushEffects();
    expect(roverReadyTransitions).toBe(2);
  });

  it('cleans up both heartbeat listeners and timers on disconnect and reconnect', () => {
    service.connect('ws://localhost:9090');
    TestBed.flushEffects();
    service.client()!.emit('connection', {} as never);
    heartbeats[0].callback();
    const oldRoverTopic = heartbeats[0].topic;
    const oldBaseStationTopic = heartbeats[1].topic;

    service.reconnect();
    TestBed.flushEffects();
    expect(unsubscribe.mock.contexts).toContain(oldRoverTopic);
    expect(unsubscribe.mock.contexts).toContain(oldBaseStationTopic);
    expect(heartbeatMonitor.roverAvailable()).toBe(false);
    expect(heartbeatMonitor.baseStationAvailable()).toBe(false);

    service.client()!.emit('connection', {} as never);
    heartbeats[0].callback();
    expect(heartbeatMonitor.roverAvailable()).toBe(false);
    heartbeats[2].callback();
    expect(heartbeatMonitor.roverAvailable()).toBe(true);

    service.disconnect();
    TestBed.flushEffects();
    expect(unsubscribe.mock.contexts).toContain(heartbeats[2].topic);
    expect(unsubscribe.mock.contexts).toContain(heartbeats[3].topic);
    vi.advanceTimersByTime(3_000);
    expect(service.status()).toBe('disconnected');
    expect(heartbeatMonitor.roverAvailable()).toBe(false);
    expect(heartbeatMonitor.baseStationAvailable()).toBe(false);
  });

  it('requires a new rover heartbeat after the WebSocket reconnects', () => {
    service.connect('ws://localhost:9090');
    TestBed.flushEffects();
    const client = service.client()!;
    client.emit('connection', {} as never);
    heartbeats[0].callback();
    client.emit('close', {} as never);
    TestBed.flushEffects();

    expect(service.status()).toBe('reconnecting');
    expect(heartbeatMonitor.roverAvailable()).toBe(false);
    expect(unsubscribe.mock.contexts).toContain(heartbeats[0].topic);
    expect(unsubscribe.mock.contexts).toContain(heartbeats[1].topic);

    vi.advanceTimersByTime(1_000);
    TestBed.flushEffects();
    service.client()!.emit('connection', {} as never);
    expect(heartbeatMonitor.roverStatus()).toBe('waiting-for-rover');
    heartbeats[2].callback();
    expect(heartbeatMonitor.roverAvailable()).toBe(true);
  });
});
