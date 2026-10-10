import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  computed,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { UnavailableOverlay } from '../../../shared/unavailable-overlay/unavailable-overlay';
import { CAMERA_HEALTH_URL, CameraSource } from '../camera-sources';
import { WhepClient, WhepReaderState } from './whep-client';

export type CameraStreamStatus =
  | 'not-configured'
  | 'connecting'
  | 'streaming'
  | 'reconnecting'
  | 'error'
  | 'unavailable'
  | 'off';

export type CameraGateway = 'base' | 'rover' | null;
type BaseAttemptMode = 'normal' | 'recovery';

const RETRY_DELAY_MS = 5_000;
const RECOVERY_POLL_INTERVAL_MS = 10_000;
const GATEWAY_FAILURE_TIMEOUT_MS = 10_000;
const HEALTHY_RECOVERY_WINDOW_MS = 10_000;
const HEALTH_REQUEST_TIMEOUT_MS = 3_000;
const MAX_RETRY_ATTEMPTS = 10;

interface CameraHealthResponse {
  readonly gatewayAvailable?: boolean;
  readonly cameras?: Partial<Record<CameraSource['id'], boolean>>;
}

/** Displays one camera and manages base-station-to-rover gateway failover. */
@Component({
  selector: 'app-camera-stream',
  imports: [MatButtonModule, MatIconModule, UnavailableOverlay],
  templateUrl: './camera-stream.html',
  styleUrl: './camera-stream.scss',
})
export class CameraStream implements AfterViewInit, OnChanges, OnDestroy {
  @Input() label = 'Camera';
  @Input() source: CameraSource | null = null;
  @Input() initialRotation = 0;
  @Input() allowRoverFallback = false;
  @Input() enabled = true;

  @ViewChild('streamFrame') private streamFrame?: ElementRef<HTMLElement>;
  @ViewChild('baseVideo') private baseVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('roverVideo') private roverVideo?: ElementRef<HTMLVideoElement>;

  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private failoverTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryPollTimer: ReturnType<typeof setTimeout> | null = null;
  private baseSession: WhepClient | null = null;
  private roverSession: WhepClient | null = null;
  private baseGeneration = 0;
  private roverGeneration = 0;
  private recoveryGeneration = 0;
  private recoveryRequestInFlight = false;
  private recoveryRequestController: AbortController | null = null;
  private recoveryAttemptInFlight = false;
  private baseAttemptMode: BaseAttemptMode = 'normal';
  private fallbackMode = false;
  private baseHealthySince: number | null = null;
  private viewReady = false;
  private configurationGeneration = 0;
  private retryCount = 0;
  private roverRetryCount = 0;

  readonly status = signal<CameraStreamStatus>('not-configured');
  readonly retryAttempt = signal(0);
  readonly rotation = signal(0);
  readonly isFullscreen = signal(false);
  readonly activeGateway = signal<CameraGateway>(null);

  readonly statusLabel = computed(() => {
    switch (this.status()) {
      case 'connecting':
        return 'Connecting';
      case 'streaming':
        return 'Live';
      case 'reconnecting':
        return 'Reconnecting';
      case 'error':
        return 'Offline';
      case 'unavailable':
        return 'Unavailable';
      case 'off':
        return 'Off';
      default:
        return 'Not configured';
    }
  });

  readonly statusIcon = computed(() => {
    switch (this.status()) {
      case 'connecting':
      case 'reconnecting':
        return 'sync';
      case 'streaming':
        return 'videocam';
      default:
        return 'videocam_off';
    }
  });

  readonly isConnecting = computed(() => {
    const currentStatus = this.status();
    return currentStatus === 'connecting' || currentStatus === 'reconnecting';
  });

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.updateConfiguration();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialRotation']) {
      this.rotation.set(this.normalizeRotation(this.initialRotation));
    }

    if ((changes['source'] || changes['allowRoverFallback'] || changes['enabled']) && this.viewReady) {
      const generation = ++this.configurationGeneration;
      queueMicrotask(() => {
        if (generation === this.configurationGeneration && this.viewReady) {
          this.updateConfiguration();
        }
      });
    }
  }

  ngOnDestroy(): void {
    this.viewReady = false;
    this.clearRetryTimer();
    this.clearFailoverTimer();
    this.stopRecoveryPolling();
    this.closeBaseSession();
    this.closeRoverSession();
  }

  retry(): void {
    if (!this.source || !this.enabled) return;

    this.updateConfiguration();
  }

  rotateClockwise(): void {
    this.rotation.update((rotation) => this.normalizeRotation(rotation + 90));
  }

  rotateCounterClockwise(): void {
    this.rotation.update((rotation) => this.normalizeRotation(rotation - 90));
  }

  async toggleFullscreen(): Promise<void> {
    const frame = this.streamFrame?.nativeElement;
    if (!frame) return;

    if (document.fullscreenElement === frame) {
      await document.exitFullscreen();
      return;
    }

    await frame.requestFullscreen?.();
  }

  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    this.isFullscreen.set(document.fullscreenElement === this.streamFrame?.nativeElement);
  }

  private updateConfiguration(): void {
    this.clearRetryTimer();
    this.clearFailoverTimer();
    this.stopRecoveryPolling();
    this.closeBaseSession();
    this.closeRoverSession();
    this.retryCount = 0;
    this.roverRetryCount = 0;
    this.retryAttempt.set(0);
    this.fallbackMode = false;
    this.recoveryAttemptInFlight = false;
    this.activeGateway.set(null);

    if (!this.source) {
      this.status.set('not-configured');
      return;
    }

    if (!this.enabled) {
      this.status.set('off');
      return;
    }

    if (!this.canStartWebRtc()) {
      this.status.set('unavailable');
      return;
    }

    this.status.set('connecting');
    this.connectBase('normal');
    this.armFailoverTimer();
  }

  private canStartWebRtc(): boolean {
    return (
      typeof RTCPeerConnection !== 'undefined' && typeof window.MediaMTXWebRTCReader === 'function'
    );
  }

  private connectBase(mode: BaseAttemptMode): void {
    const source = this.source;
    const video = this.baseVideo?.nativeElement;
    if (!source || !video || !this.viewReady || !this.enabled || !this.canStartWebRtc()) return;

    this.closeBaseSession();
    const generation = ++this.baseGeneration;
    this.baseAttemptMode = mode;
    this.recoveryAttemptInFlight = mode === 'recovery';
    const session = new WhepClient({
      onStateChange: (readerState) => this.onBaseReaderState(generation, readerState),
    });
    this.baseSession = session;

    try {
      session.connect(source.whepUrl, video);
    } catch {
      this.onBaseReaderState(generation, 'error');
    }
  }

  private onBaseReaderState(generation: number, state: WhepReaderState): void {
    if (generation !== this.baseGeneration || !this.baseSession) return;

    if (state === 'streaming') {
      this.retryCount = 0;
      this.retryAttempt.set(0);
      this.clearRetryTimer();
      this.clearFailoverTimer();
      this.recoveryAttemptInFlight = false;
      this.fallbackMode = false;
      this.baseAttemptMode = 'normal';
      this.activeGateway.set('base');
      this.status.set('streaming');
      this.closeRoverSession();
      this.stopRecoveryPolling();
      return;
    }

    if (state === 'reconnecting') {
      this.status.set('reconnecting');
      this.armFailoverTimer();
      return;
    }

    const failedDuringRecovery = this.baseAttemptMode === 'recovery';
    this.closeBaseSession(generation);

    if (failedDuringRecovery) {
      this.recoveryAttemptInFlight = false;
      this.baseHealthySince = null;
      this.scheduleRecoveryPoll(RECOVERY_POLL_INTERVAL_MS);
      return;
    }

    this.armFailoverTimer();
    if (!this.fallbackMode) this.schedulePrimaryRetry();
  }

  private connectRover(): void {
    const source = this.source;
    const video = this.roverVideo?.nativeElement;
    if (!source || !video || !this.viewReady || !this.enabled || !this.canStartWebRtc()) {
      this.status.set('unavailable');
      return;
    }

    this.closeRoverSession();
    const generation = ++this.roverGeneration;
    const session = new WhepClient({
      onStateChange: (readerState) => this.onRoverReaderState(generation, readerState),
    });
    this.roverSession = session;

    try {
      session.connect(source.roverWhepUrl, video);
    } catch {
      this.onRoverReaderState(generation, 'error');
    }
  }

  private onRoverReaderState(generation: number, state: WhepReaderState): void {
    if (generation !== this.roverGeneration || !this.roverSession) return;

    if (state === 'streaming') {
      this.roverRetryCount = 0;
      this.retryAttempt.set(0);
      this.activeGateway.set('rover');
      this.status.set('streaming');
      this.startRecoveryPolling();
      return;
    }

    if (state === 'reconnecting') {
      this.status.set('reconnecting');
      return;
    }

    this.closeRoverSession(generation);
    this.scheduleRoverRetry();
  }

  private armFailoverTimer(): void {
    if (this.failoverTimer || this.fallbackMode || !this.source || !this.enabled) return;

    this.failoverTimer = setTimeout(() => {
      this.failoverTimer = null;
      if (this.status() !== 'streaming' || this.activeGateway() !== 'base') {
        this.enterFallbackMode();
      }
    }, GATEWAY_FAILURE_TIMEOUT_MS);
  }

  private enterFallbackMode(): void {
    if (this.fallbackMode || !this.source || !this.enabled) return;

    this.fallbackMode = true;
    this.clearRetryTimer();
    this.clearFailoverTimer();
    this.closeBaseSession();
    this.activeGateway.set(null);
    this.status.set(this.allowRoverFallback ? 'connecting' : 'unavailable');

    if (this.allowRoverFallback) this.connectRover();
    this.startRecoveryPolling();
  }

  private schedulePrimaryRetry(): void {
    if (this.retryTimer || this.fallbackMode || !this.viewReady || !this.enabled) return;

    if (this.retryCount >= MAX_RETRY_ATTEMPTS) {
      this.status.set('error');
      return;
    }

    this.retryCount += 1;
    this.retryAttempt.set(this.retryCount);
    this.status.set('reconnecting');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.fallbackMode) this.connectBase('normal');
    }, RETRY_DELAY_MS);
  }

  private scheduleRoverRetry(): void {
    if (this.retryTimer || !this.fallbackMode || !this.viewReady || !this.enabled) return;

    if (this.roverRetryCount >= MAX_RETRY_ATTEMPTS) {
      this.status.set('error');
      return;
    }

    this.roverRetryCount += 1;
    this.retryAttempt.set(this.roverRetryCount);
    this.status.set('reconnecting');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.fallbackMode && this.allowRoverFallback) this.connectRover();
    }, RETRY_DELAY_MS);
  }

  private startRecoveryPolling(): void {
    if (!this.enabled || !this.fallbackMode || !this.viewReady || this.recoveryPollTimer) return;
    void this.pollBaseReadiness(this.recoveryGeneration);
  }

  private scheduleRecoveryPoll(delay: number): void {
    if (!this.enabled || !this.fallbackMode || !this.viewReady || this.recoveryPollTimer) return;

    const generation = this.recoveryGeneration;
    this.recoveryPollTimer = setTimeout(() => {
      this.recoveryPollTimer = null;
      void this.pollBaseReadiness(generation);
    }, delay);
  }

  private async pollBaseReadiness(generation: number): Promise<void> {
    if (
      generation !== this.recoveryGeneration ||
      !this.fallbackMode ||
      !this.enabled ||
      this.recoveryRequestInFlight ||
      this.recoveryAttemptInFlight
    ) {
      return;
    }

    this.recoveryRequestInFlight = true;
    const ready = await this.isBaseCameraReady();
    this.recoveryRequestInFlight = false;

    if (generation !== this.recoveryGeneration || !this.fallbackMode || !this.viewReady) return;

    if (!ready) {
      this.baseHealthySince = null;
      this.scheduleRecoveryPoll(RECOVERY_POLL_INTERVAL_MS);
      return;
    }

    const now = Date.now();
    if (this.baseHealthySince === null) {
      this.baseHealthySince = now;
      this.scheduleRecoveryPoll(RECOVERY_POLL_INTERVAL_MS);
      return;
    }

    const healthyFor = now - this.baseHealthySince;
    if (healthyFor > HEALTHY_RECOVERY_WINDOW_MS) {
      this.recoveryAttemptInFlight = true;
      this.connectBase('recovery');
      return;
    }

    this.scheduleRecoveryPoll(
      healthyFor >= HEALTHY_RECOVERY_WINDOW_MS ? 1 : RECOVERY_POLL_INTERVAL_MS,
    );
  }

  private async isBaseCameraReady(): Promise<boolean> {
    const source = this.source;
    if (!source || typeof fetch !== 'function') return false;

    const controller = new AbortController();
    this.recoveryRequestController = controller;
    const timeout = setTimeout(() => controller.abort(), HEALTH_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(CAMERA_HEALTH_URL, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) return false;

      const health = (await response.json()) as CameraHealthResponse;
      return health.gatewayAvailable === true && health.cameras?.[source.id] === true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
      if (this.recoveryRequestController === controller) {
        this.recoveryRequestController = null;
      }
    }
  }

  private stopRecoveryPolling(): void {
    this.recoveryGeneration += 1;
    this.recoveryRequestController?.abort();
    this.recoveryRequestController = null;
    if (this.recoveryPollTimer) clearTimeout(this.recoveryPollTimer);
    this.recoveryPollTimer = null;
    this.recoveryRequestInFlight = false;
    this.recoveryAttemptInFlight = false;
    this.baseHealthySince = null;
  }

  private closeBaseSession(expectedGeneration?: number): void {
    if (expectedGeneration !== undefined && expectedGeneration !== this.baseGeneration) return;

    this.baseGeneration += 1;
    const session = this.baseSession;
    this.baseSession = null;
    session?.close();
    if (this.baseVideo) this.baseVideo.nativeElement.srcObject = null;
  }

  private closeRoverSession(expectedGeneration?: number): void {
    if (expectedGeneration !== undefined && expectedGeneration !== this.roverGeneration) return;

    this.roverGeneration += 1;
    const session = this.roverSession;
    this.roverSession = null;
    session?.close();
    if (this.roverVideo) this.roverVideo.nativeElement.srcObject = null;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private clearFailoverTimer(): void {
    if (this.failoverTimer) clearTimeout(this.failoverTimer);
    this.failoverTimer = null;
  }

  private normalizeRotation(value: number): number {
    return ((value % 360) + 360) % 360;
  }
}
