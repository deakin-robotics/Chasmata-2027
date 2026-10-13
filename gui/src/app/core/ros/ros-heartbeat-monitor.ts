import { Service, computed, effect, inject, signal } from '@angular/core';
import { Ros, Topic } from 'roslib';

import { RosConnection, type RosConnectionStatus } from './ros-connection';

const HEARTBEAT_TIMEOUT_MS = 3_000;
const ROVER_HEARTBEAT_TOPIC = '/rover/heartbeat';
const BASE_STATION_HEARTBEAT_TOPIC = '/basestation/heartbeat';
const HEARTBEAT_MESSAGE_TYPE = 'std_msgs/msg/Empty';

export type RoverConnectionStatus = RosConnectionStatus | 'waiting-for-rover';

/** Tracks rover and base-station liveness over the shared ROS connection. */
@Service()
export class RosHeartbeatMonitor {
  private readonly rosConnection = inject(RosConnection);

  private activeClient: Ros | null = null;
  private roverTopic: Topic | null = null;
  private baseStationTopic: Topic | null = null;
  private roverTimer: ReturnType<typeof setTimeout> | null = null;
  private baseStationTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly roverAvailableState = signal(false);
  private readonly baseStationAvailableState = signal(false);

  readonly roverAvailable = computed(
    () => this.rosConnection.status() === 'connected' && this.roverAvailableState(),
  );
  readonly baseStationAvailable = computed(
    () => this.rosConnection.status() === 'connected' && this.baseStationAvailableState(),
  );
  readonly roverStatus = computed<RoverConnectionStatus>(() => {
    const connectionStatus = this.rosConnection.status();
    if (connectionStatus !== 'connected') return connectionStatus;
    return this.roverAvailable() ? 'connected' : 'waiting-for-rover';
  });
  readonly isRoverConnecting = computed(() => {
    const status = this.roverStatus();
    return (
      status === 'connecting' ||
      status === 'waiting-for-rover' ||
      status === 'reconnecting'
    );
  });

  private readonly clientEffect = effect((onCleanup) => {
    const client = this.rosConnection.client();
    if (!client) return;

    const onConnection = () => this.startMonitoring(client);
    const onUnavailable = () => this.stopMonitoring(client);

    client.on('connection', onConnection);
    client.on('close', onUnavailable);
    client.on('error', onUnavailable);

    if (client.isConnected) onConnection();

    onCleanup(() => {
      client.off('connection', onConnection);
      client.off('close', onUnavailable);
      client.off('error', onUnavailable);
      this.stopMonitoring(client);
    });
  });

  private startMonitoring(client: Ros): void {
    if (this.rosConnection.client() !== client || this.activeClient === client) return;
    if (this.activeClient) this.stopMonitoring(this.activeClient);

    this.activeClient = client;
    this.roverTopic = this.subscribe(client, ROVER_HEARTBEAT_TOPIC, 'rover');
    this.baseStationTopic = this.subscribe(
      client,
      BASE_STATION_HEARTBEAT_TOPIC,
      'base-station',
    );
  }

  private subscribe(
    client: Ros,
    name: string,
    source: 'rover' | 'base-station',
  ): Topic {
    const topic = new Topic({ ros: client, name, messageType: HEARTBEAT_MESSAGE_TYPE });
    topic.subscribe(() => this.handleHeartbeat(client, topic, source));
    return topic;
  }

  private handleHeartbeat(
    client: Ros,
    topic: Topic,
    source: 'rover' | 'base-station',
  ): void {
    const activeTopic = source === 'rover' ? this.roverTopic : this.baseStationTopic;
    if (
      this.rosConnection.client() !== client ||
      this.activeClient !== client ||
      activeTopic !== topic
    ) return;

    const availableState =
      source === 'rover' ? this.roverAvailableState : this.baseStationAvailableState;
    const timer = source === 'rover' ? this.roverTimer : this.baseStationTimer;
    if (timer) clearTimeout(timer);

    const timeout = setTimeout(() => {
      const currentTopic = source === 'rover' ? this.roverTopic : this.baseStationTopic;
      if (
        this.rosConnection.client() !== client ||
        this.activeClient !== client ||
        currentTopic !== topic
      ) return;

      if (source === 'rover') this.roverTimer = null;
      else this.baseStationTimer = null;
      availableState.set(false);
    }, HEARTBEAT_TIMEOUT_MS);

    if (source === 'rover') this.roverTimer = timeout;
    else this.baseStationTimer = timeout;
    availableState.set(true);
  }

  private stopMonitoring(client: Ros): void {
    if (this.activeClient !== client) return;

    if (this.roverTimer) clearTimeout(this.roverTimer);
    if (this.baseStationTimer) clearTimeout(this.baseStationTimer);
    this.roverTimer = null;
    this.baseStationTimer = null;
    this.roverTopic?.unsubscribe();
    this.baseStationTopic?.unsubscribe();
    this.roverTopic = null;
    this.baseStationTopic = null;
    this.activeClient = null;
    this.roverAvailableState.set(false);
    this.baseStationAvailableState.set(false);
  }
}
