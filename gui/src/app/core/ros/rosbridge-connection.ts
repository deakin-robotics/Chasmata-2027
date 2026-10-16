import { OnDestroy, Service, computed, signal } from '@angular/core';
import { Ros } from 'roslib';

export type RosConnectionStatus =
  'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;

/** Owns one independent ROSLIB connection to a rosbridge endpoint. */
@Service()
export abstract class RosbridgeConnection implements OnDestroy {
  private rosClient: Ros | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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
    return status === 'connecting' || status === 'reconnecting';
  });

  /** Connect to this service's rosbridge WebSocket endpoint. */
  connect(url: string): void {
    let normalizedUrl: string;

    try {
      normalizedUrl = this.normalizeWebSocketUrl(url);
    } catch (error) {
      this.errorState.set(this.toErrorMessage(error));
      this.statusState.set('error');
      return;
    }

    if (this.rosClient?.isConnected && this.urlState() === normalizedUrl) return;

    this.allowReconnect = true;
    this.reconnectAttempts = 0;
    this.reconnectAttemptState.set(0);
    this.urlState.set(normalizedUrl);
    this.errorState.set(null);
    this.clearReconnectTimer();
    this.openConnection(normalizedUrl, false);
  }

  /** Close this connection and cancel automatic reconnection. */
  disconnect(): void {
    this.allowReconnect = false;
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    this.reconnectAttemptState.set(0);
    this.disposeClient();
    this.errorState.set(null);
    this.statusState.set('disconnected');
  }

  /** Immediately retry this service's most recently configured endpoint. */
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
      this.statusState.set('connected');
    });

    client.on('error', (error) => {
      if (this.rosClient !== client) return;

      this.errorState.set(this.toErrorMessage(error));
      this.scheduleReconnect();
    });

    client.on('close', () => {
      if (this.rosClient !== client) return;

      this.clientState.set(null);

      if (this.allowReconnect) {
        this.scheduleReconnect();
      } else if (this.statusState() !== 'error') {
        this.statusState.set('disconnected');
      }
    });

    void client.connect(url).catch((error: unknown) => {
      if (this.rosClient !== client) return;

      this.errorState.set(this.toErrorMessage(error));
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (!this.allowReconnect || this.reconnectTimer || !this.urlState()) return;

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.errorState.set(`Unable to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts.`);
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
      if (currentUrl && this.allowReconnect) this.openConnection(currentUrl, true);
    }, delay);
  }

  private disposeClient(): void {
    const client = this.rosClient;
    this.rosClient = null;
    this.clientState.set(null);

    if (!client) return;

    client.removeAllListeners();
    client.close();
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private normalizeWebSocketUrl(value: string): string {
    const trimmedValue = value.trim();
    if (!trimmedValue) throw new Error('A ROSbridge URL is required.');

    const candidate = trimmedValue.startsWith('/')
      ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}${trimmedValue}`
      : /^wss?:\/\//i.test(trimmedValue)
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
    if (error instanceof Event && error.type) return `ROSbridge connection ${error.type}.`;
    return 'Unable to connect to ROSbridge.';
  }
}
