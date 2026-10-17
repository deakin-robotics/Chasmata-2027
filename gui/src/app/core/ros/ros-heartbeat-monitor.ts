import { Service, computed, effect, inject, signal } from '@angular/core';
import { Ros, Topic } from 'roslib';

import { BaseStationConnection } from './base-station-connection';
import { RosConnection, type RosConnectionStatus } from './ros-connection';

const HEARTBEAT_TIMEOUT_MS = 3_000;
const ROVER_HEARTBEAT_TOPIC = '/rover/heartbeat';
const BASE_STATION_HEARTBEAT_TOPIC = '/basestation/heartbeat';
const HEARTBEAT_MESSAGE_TYPE = 'std_msgs/msg/Empty';

export type RoverConnectionStatus = RosConnectionStatus | 'waiting-for-rover';

/** Tracks rover and base-station liveness over their independent ROS connections. */
@Service()
export class RosHeartbeatMonitor {
  private readonly roverConnection = inject(RosConnection);
  private readonly baseStationConnection = inject(BaseStationConnection);

  private activeRoverClient: Ros | null = null;
  private activeBaseStationClient: Ros | null = null;
  private roverTopic: Topic | null = null;
  private baseStationTopic: Topic | null = null;
  private roverTimer: ReturnType<typeof setTimeout> | null = null;
  private baseStationTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly roverAvailableState = signal(false);
  private readonly baseStationAvailableState = signal(false);
  private readonly roverWasAvailableState = signal(false);
  private readonly baseStationWasAvailableState = signal(false);

  readonly roverAvailable = computed(
    () => this.roverConnection.status() === 'connected' && this.roverAvailableState(),
  );
  readonly baseStationAvailable = computed(
    () => this.baseStationConnection.status() === 'connected' && this.baseStationAvailableState(),
  );
  readonly roverWasAvailable = this.roverWasAvailableState.asReadonly();
  readonly baseStationWasAvailable = this.baseStationWasAvailableState.asReadonly();
  readonly roverStatus = computed<RoverConnectionStatus>(() => {
    const connectionStatus = this.roverConnection.status();
    if (connectionStatus !== 'connected') return connectionStatus;
    return this.roverAvailable() ? 'connected' : 'waiting-for-rover';
  });
  readonly isRoverConnecting = computed(() => {
    const status = this.roverStatus();
    return status === 'connecting' || status === 'waiting-for-rover' || status === 'reconnecting';
  });

  private readonly roverClientEffect = effect((onCleanup) => {
    const client = this.roverConnection.client();
    if (!client) return;

    const onConnection = () => this.startMonitoring(client, 'rover');
    const onUnavailable = () => this.stopMonitoring(client, 'rover');

    client.on('connection', onConnection);
    client.on('close', onUnavailable);
    client.on('error', onUnavailable);

    if (client.isConnected) onConnection();

    onCleanup(() => {
      client.off('connection', onConnection);
      client.off('close', onUnavailable);
      client.off('error', onUnavailable);
      this.stopMonitoring(client, 'rover');
    });
  });

  private readonly baseStationClientEffect = effect((onCleanup) => {
    const client = this.baseStationConnection.client();
    if (!client) return;

    const onConnection = () => this.startMonitoring(client, 'base-station');
    const onUnavailable = () => this.stopMonitoring(client, 'base-station');

    client.on('connection', onConnection);
    client.on('close', onUnavailable);
    client.on('error', onUnavailable);

    if (client.isConnected) onConnection();

    onCleanup(() => {
      client.off('connection', onConnection);
      client.off('close', onUnavailable);
      client.off('error', onUnavailable);
      this.stopMonitoring(client, 'base-station');
    });
  });

  private startMonitoring(client: Ros, source: 'rover' | 'base-station'): void {
    const connection = source === 'rover' ? this.roverConnection : this.baseStationConnection;
    if (connection.client() !== client) return;

    const activeClient = this.getActiveClient(source);
    if (activeClient === client) return;
    if (activeClient) this.stopMonitoring(activeClient, source);

    this.setActiveClient(source, client);
    const name = source === 'rover' ? ROVER_HEARTBEAT_TOPIC : BASE_STATION_HEARTBEAT_TOPIC;
    this.setTopic(source, this.subscribe(client, name, source));
  }

  private subscribe(client: Ros, name: string, source: 'rover' | 'base-station'): Topic {
    const topic = new Topic({ ros: client, name, messageType: HEARTBEAT_MESSAGE_TYPE });
    topic.subscribe(() => this.handleHeartbeat(client, topic, source));
    return topic;
  }

  private handleHeartbeat(client: Ros, topic: Topic, source: 'rover' | 'base-station'): void {
    const activeTopic = this.getTopic(source);
    const connection = source === 'rover' ? this.roverConnection : this.baseStationConnection;
    if (
      connection.client() !== client ||
      this.getActiveClient(source) !== client ||
      activeTopic !== topic
    )
      return;

    const availableState =
      source === 'rover' ? this.roverAvailableState : this.baseStationAvailableState;
    const timer = source === 'rover' ? this.roverTimer : this.baseStationTimer;
    if (timer) clearTimeout(timer);

    const timeout = setTimeout(() => {
      const currentTopic = this.getTopic(source);
      if (
        connection.client() !== client ||
        this.getActiveClient(source) !== client ||
        currentTopic !== topic
      )
        return;

      if (source === 'rover') this.roverTimer = null;
      else this.baseStationTimer = null;
      availableState.set(false);
    }, HEARTBEAT_TIMEOUT_MS);

    if (source === 'rover') this.roverTimer = timeout;
    else this.baseStationTimer = timeout;
    availableState.set(true);
    if (source === 'rover') this.roverWasAvailableState.set(true);
    else this.baseStationWasAvailableState.set(true);
  }

  /** Clears link history when the operator ends the shared ROS Link session. */
  resetLinkHistory(): void {
    this.roverWasAvailableState.set(false);
    this.baseStationWasAvailableState.set(false);
  }

  private stopMonitoring(client: Ros, source: 'rover' | 'base-station'): void {
    if (this.getActiveClient(source) !== client) return;

    const timer = source === 'rover' ? this.roverTimer : this.baseStationTimer;
    if (timer) clearTimeout(timer);
    if (source === 'rover') this.roverTimer = null;
    else this.baseStationTimer = null;
    this.getTopic(source)?.unsubscribe();
    this.setTopic(source, null);
    this.setActiveClient(source, null);
    if (source === 'rover') this.roverAvailableState.set(false);
    else this.baseStationAvailableState.set(false);
  }

  private getActiveClient(source: 'rover' | 'base-station'): Ros | null {
    return source === 'rover' ? this.activeRoverClient : this.activeBaseStationClient;
  }

  private setActiveClient(source: 'rover' | 'base-station', client: Ros | null): void {
    if (source === 'rover') this.activeRoverClient = client;
    else this.activeBaseStationClient = client;
  }

  private getTopic(source: 'rover' | 'base-station'): Topic | null {
    return source === 'rover' ? this.roverTopic : this.baseStationTopic;
  }

  private setTopic(source: 'rover' | 'base-station', topic: Topic | null): void {
    if (source === 'rover') this.roverTopic = topic;
    else this.baseStationTopic = topic;
  }
}
