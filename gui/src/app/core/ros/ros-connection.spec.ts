import { effect } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Ros, Topic } from 'roslib';

import { BaseStationConnection } from './base-station-connection';
import { RosConnection } from './ros-connection';
import { RosHeartbeatMonitor } from './ros-heartbeat-monitor';

describe('RosConnection and RosHeartbeatMonitor', () => {
  let service: RosConnection;
  let baseStationConnection: BaseStationConnection;
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
    baseStationConnection = TestBed.inject(BaseStationConnection);
    heartbeatMonitor = TestBed.inject(RosHeartbeatMonitor);
    TestBed.flushEffects();
  });

  afterEach(() => {
    service.disconnect();
    baseStationConnection.disconnect();
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

  it('keeps Rover and BaseStation sockets and disconnect actions independent', () => {
    service.connect('localhost:9090');
    const roverClient = service.client()!;
    TestBed.flushEffects();
    roverClient.emit('connection', {} as never);

    baseStationConnection.connect('localhost:9091');
    const baseStationClient = baseStationConnection.client()!;
    TestBed.flushEffects();
    baseStationClient.emit('connection', {} as never);

    expect(roverClient).not.toBe(baseStationClient);
    expect(service.status()).toBe('connected');
    expect(baseStationConnection.status()).toBe('connected');

    baseStationConnection.disconnect();
    TestBed.flushEffects();

    expect(baseStationConnection.status()).toBe('disconnected');
    expect(baseStationConnection.client()).toBeNull();
    expect(service.status()).toBe('connected');
    expect(service.client()).toBe(roverClient);
  });

  it('retries a failed BaseStation socket without disturbing an active Rover socket', () => {
    service.connect('localhost:9090');
    const roverClient = service.client()!;
    TestBed.flushEffects();
    roverClient.emit('connection', {} as never);

    baseStationConnection.connect('');
    expect(baseStationConnection.status()).toBe('error');
    expect(service.status()).toBe('connected');

    baseStationConnection.connect('localhost:9091');
    const failedClient = baseStationConnection.client()!;
    TestBed.flushEffects();
    failedClient.emit('connection', {} as never);
    failedClient.emit('close', {} as never);
    TestBed.flushEffects();

    expect(baseStationConnection.status()).toBe('reconnecting');
    expect(service.status()).toBe('connected');

    vi.advanceTimersByTime(3_000);
    TestBed.flushEffects();
    const recoveredClient = baseStationConnection.client()!;
    expect(recoveredClient).not.toBe(failedClient);
    recoveredClient.emit('connection', {} as never);

    expect(baseStationConnection.status()).toBe('connected');
    expect(service.status()).toBe('connected');
    expect(service.client()).toBe(roverClient);
  });

  it('retries a failed Rover socket without disturbing an active BaseStation socket', () => {
    baseStationConnection.connect('localhost:9091');
    const baseStationClient = baseStationConnection.client()!;
    TestBed.flushEffects();
    baseStationClient.emit('connection', {} as never);

    service.connect('');
    expect(service.status()).toBe('error');
    expect(baseStationConnection.status()).toBe('connected');

    service.connect('localhost:9090');
    const failedClient = service.client()!;
    TestBed.flushEffects();
    failedClient.emit('connection', {} as never);
    failedClient.emit('close', {} as never);
    TestBed.flushEffects();

    expect(service.status()).toBe('reconnecting');
    expect(baseStationConnection.status()).toBe('connected');

    vi.advanceTimersByTime(3_000);
    TestBed.flushEffects();
    const recoveredClient = service.client()!;
    expect(recoveredClient).not.toBe(failedClient);
    recoveredClient.emit('connection', {} as never);

    expect(service.status()).toBe('connected');
    expect(baseStationConnection.status()).toBe('connected');
    expect(baseStationConnection.client()).toBe(baseStationClient);

    service.disconnect();
    expect(baseStationConnection.status()).toBe('connected');
  });

  it('continues retrying a failed Rover socket until it is disconnected', () => {
    service.connect('localhost:9090');
    let failedClient = service.client()!;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      failedClient.emit('close', {} as never);
      TestBed.flushEffects();

      expect(service.status()).toBe('reconnecting');
      vi.advanceTimersByTime(3_000);
      TestBed.flushEffects();
      failedClient = service.client()!;
    }

    expect(service.status()).toBe('reconnecting');
    expect(service.reconnectAttempt()).toBe(6);
  });

  it('returns to a clean disconnected state', () => {
    service.connect('');
    service.disconnect();

    expect(service.status()).toBe('disconnected');
    expect(service.error()).toBeNull();
    expect(service.url()).toBeNull();
    expect(service.reconnectAttempt()).toBe(0);
  });

  it('tracks each heartbeat on its matching ROS connection', () => {
    let roverReadyTransitions = 0;
    TestBed.runInInjectionContext(() =>
      effect(() => {
        if (heartbeatMonitor.roverAvailable()) roverReadyTransitions += 1;
      }),
    );
    TestBed.flushEffects();

    service.connect('ws://localhost:9090');
    const client = service.client()!;
    TestBed.flushEffects();
    client.emit('connection', {} as never);

    expect(service.status()).toBe('connected');
    expect(service.isConnected()).toBe(true);
    expect(heartbeatMonitor.roverStatus()).toBe('waiting-for-rover');
    expect(heartbeats).toHaveLength(1);
    expect(heartbeats[0].topic.ros).toBe(client);
    expect(heartbeats[0].topic.name).toBe('/rover/heartbeat');
    expect(heartbeats[0].topic.messageType).toBe('std_msgs/msg/Empty');

    baseStationConnection.connect('ws://localhost:9091');
    TestBed.flushEffects();
    const connectedBaseStationClient = baseStationConnection.client()!;
    connectedBaseStationClient.emit('connection', {} as never);
    expect(connectedBaseStationClient).not.toBe(client);
    expect(heartbeats).toHaveLength(2);
    expect(heartbeats[1].topic.ros).toBe(connectedBaseStationClient);
    expect(heartbeats[1].topic.name).toBe('/basestation/heartbeat');
    expect(heartbeats[1].topic.messageType).toBe('std_msgs/msg/Empty');

    heartbeats[0].callback();
    expect(heartbeatMonitor.roverAvailable()).toBe(true);
    expect(heartbeatMonitor.baseStationAvailable()).toBe(false);
    expect(baseStationConnection.client()).toBe(connectedBaseStationClient);
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

  it('keeps the BaseStation heartbeat active when Rover disconnects', () => {
    service.connect('ws://localhost:9090');
    TestBed.flushEffects();
    service.client()!.emit('connection', {} as never);
    heartbeats[0].callback();
    baseStationConnection.connect('ws://localhost:9091');
    TestBed.flushEffects();
    baseStationConnection.client()!.emit('connection', {} as never);
    heartbeats[1].callback();

    service.disconnect();
    TestBed.flushEffects();
    expect(unsubscribe.mock.contexts).toContain(heartbeats[0].topic);
    expect(unsubscribe.mock.contexts).not.toContain(heartbeats[1].topic);
    expect(heartbeatMonitor.roverAvailable()).toBe(false);
    expect(heartbeatMonitor.baseStationAvailable()).toBe(true);

    heartbeats[1].callback();
    expect(heartbeatMonitor.baseStationAvailable()).toBe(true);

    service.connect('ws://localhost:9090');
    TestBed.flushEffects();
    service.client()!.emit('connection', {} as never);
    heartbeats[2].callback();
    expect(heartbeatMonitor.roverAvailable()).toBe(true);
    expect(heartbeatMonitor.baseStationAvailable()).toBe(true);

    baseStationConnection.disconnect();
    TestBed.flushEffects();
    expect(unsubscribe.mock.contexts).toContain(heartbeats[1].topic);
    expect(heartbeatMonitor.roverAvailable()).toBe(true);
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

    vi.advanceTimersByTime(3_000);
    TestBed.flushEffects();
    service.client()!.emit('connection', {} as never);
    expect(heartbeatMonitor.roverStatus()).toBe('waiting-for-rover');
    heartbeats[1].callback();
    expect(heartbeatMonitor.roverAvailable()).toBe(true);
  });
});
