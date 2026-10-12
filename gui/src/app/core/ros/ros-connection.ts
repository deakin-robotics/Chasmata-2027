import { OnDestroy, Service, computed, signal } from '@angular/core';
import { Ros, Topic } from 'roslib';

export type RosConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'waiting-for-rover'
  | 'connected'
  | 'reconnecting'
  | 'error';

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const HEARTBEAT_TIMEOUT_MS = 3_000;

/**
 * Owns the application's single ROSLIB connection to rosbridge.
 *
 * Feature services should reuse `client()` rather than create their own
 * ROSLIB.Ros instances. UI components should call the public methods and
 * render the exposed signals; they should not handle WebSocket events.
 */
@Service()
export class RosConnection implements OnDestroy {
  private rosClient: Ros | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTopic: Topic | null = null;
  private reconnectAttempts = 0;
  private allowReconnect = false;

  private readonly clientState = signal<Ros | null>(null);
  private readonly statusState = signal<RosConnectionStatus>('disconnected');
  private readonly urlState = signal<string | null>(null);
  private readonly errorState = signal<string | null>(null);
  private readonly reconnectAttemptState = signal(0);

  readonly client = this.clientState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly url = this.urlState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly reconnectAttempt = this.reconnectAttemptState.asReadonly();

  readonly isConnected = computed(() => this.statusState() === 'connected');
  readonly isConnecting = computed(() => {
    const status = this.statusState();
    return (
      status === 'connecting' ||
      status === 'reconnecting' ||
      status === 'waiting-for-rover'
    );
  });

  /** Connect to a rosbridge WebSocket endpoint. */
  connect(url: string): void {
    let normalizedUrl: string;

    try {
      normalizedUrl = this.normalizeWebSocketUrl(url);
    } catch (error) {
      this.errorState.set(this.toErrorMessage(error));
      this.statusState.set('error');
      return;
    }

    if (this.rosClient?.isConnected && this.urlState() === normalizedUrl) {
      return;
    }

    this.allowReconnect = true;
    this.reconnectAttempts = 0;
    this.reconnectAttemptState.set(0);
    this.urlState.set(normalizedUrl);
    this.errorState.set(null);
    this.clearReconnectTimer();
    this.openConnection(normalizedUrl, false);
  }

  /** Close the connection and cancel automatic reconnection. */
  disconnect(): void {
    this.allowReconnect = false;
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    this.reconnectAttemptState.set(0);
    this.disposeClient();
    this.errorState.set(null);
    this.statusState.set('disconnected');
  }

  /** Immediately retry the most recently configured endpoint. */
  reconnect(): void {
    const currentUrl = this.urlState();

    if (!currentUrl) {
      this.errorState.set('No ROSbridge URL has been configured.');
      this.statusState.set('error');
      return;
    }

    this.allowReconnect = true;
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    this.reconnectAttemptState.set(0);
    this.errorState.set(null);
    this.openConnection(currentUrl, true);
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  private openConnection(url: string, reconnecting: boolean): void {
    this.disposeClient();
    this.statusState.set(reconnecting ? 'reconnecting' : 'connecting');

    const client = new Ros();
    this.rosClient = client;
    this.clientState.set(client);

    client.on('connection', () => {
      if (this.rosClient !== client) return;

      this.clearReconnectTimer();
      this.reconnectAttempts = 0;
      this.reconnectAttemptState.set(0);
      this.errorState.set(null);
      this.statusState.set('waiting-for-rover');
      this.subscribeToHeartbeat(client);
    });

    client.on('error', (error) => {
      if (this.rosClient !== client) return;

      this.disposeHeartbeat();
      this.errorState.set(this.toErrorMessage(error));
      this.scheduleReconnect();
    });

    client.on('close', () => {
      if (this.rosClient !== client) return;

      this.disposeHeartbeat();
      this.clientState.set(null);

      if (this.allowReconnect) {
        this.scheduleReconnect();
      } else if (this.statusState() !== 'error') {
        this.statusState.set('disconnected');
      }
    });

    void client.connect(url).catch((error: unknown) => {
      if (this.rosClient !== client) return;

      this.disposeHeartbeat();
      this.errorState.set(this.toErrorMessage(error));
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (!this.allowReconnect || this.reconnectTimer || !this.urlState()) return;

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.errorState.set(
        `Unable to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts.`,
      );
      this.allowReconnect = false;
      this.statusState.set('error');
      return;
    }

    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempts,
      MAX_RECONNECT_DELAY_MS,
    );

    this.statusState.set('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts += 1;
      this.reconnectAttemptState.set(this.reconnectAttempts);

      const currentUrl = this.urlState();
      if (currentUrl && this.allowReconnect) {
        this.openConnection(currentUrl, true);
      }
    }, delay);
  }

  private disposeClient(): void {
    this.disposeHeartbeat();
    const client = this.rosClient;
    this.rosClient = null;
    this.clientState.set(null);

    if (!client) return;

    client.removeAllListeners();
    client.close();
  }

  private subscribeToHeartbeat(client: Ros): void {
    this.disposeHeartbeat();
    const topic = new Topic({
      ros: client,
      name: '/rover/heartbeat',
      messageType: 'std_msgs/msg/Empty',
    });
    this.heartbeatTopic = topic;
    topic.subscribe(() => {
      if (this.rosClient !== client || this.heartbeatTopic !== topic) return;

      if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = setTimeout(() => {
        if (this.rosClient !== client || this.heartbeatTopic !== topic) return;
        this.heartbeatTimer = null;
        this.statusState.set('waiting-for-rover');
      }, HEARTBEAT_TIMEOUT_MS);

      if (this.statusState() !== 'connected') this.statusState.set('connected');
    });
  }

  private disposeHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.heartbeatTopic?.unsubscribe();
    this.heartbeatTopic = null;
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private normalizeWebSocketUrl(value: string): string {
    const trimmedValue = value.trim();
    if (!trimmedValue) throw new Error('A ROSbridge URL is required.');

    const candidate = /^wss?:\/\//i.test(trimmedValue)
      ? trimmedValue
      : `ws://${trimmedValue}`;
    const parsedUrl = new URL(candidate);

    if (!['ws:', 'wss:'].includes(parsedUrl.protocol)) {
      throw new Error('The ROSbridge URL must use ws:// or wss://.');
    }

    return parsedUrl.toString().replace(/\/$/, '');
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (error instanceof Event && error.type) {
      return `ROSbridge connection ${error.type}.`;
    }
    return 'Unable to connect to ROSbridge.';
  }
}
