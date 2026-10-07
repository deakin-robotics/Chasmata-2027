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
import { CameraSource } from '../camera-sources';
import { WhepClient, WhepReaderState } from './whep-client';

export type CameraStreamStatus =
  | 'not-configured'
  | 'connecting'
  | 'streaming'
  | 'reconnecting'
  | 'error'
  | 'unavailable';

const RETRY_DELAY_MS = 5_000;
const MAX_RETRY_ATTEMPTS = 10;

/** Displays and recovers one receive-only WHEP camera session. */
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

  @ViewChild('streamFrame') private streamFrame?: ElementRef<HTMLElement>;
  @ViewChild('streamVideo') private streamVideo?: ElementRef<HTMLVideoElement>;

  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private session: WhepClient | null = null;
  private connectionGeneration = 0;
  private viewReady = false;

  readonly status = signal<CameraStreamStatus>('not-configured');
  readonly retryAttempt = signal(0);
  readonly rotation = signal(0);
  readonly isFullscreen = signal(false);

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
    const status = this.status();
    return status === 'connecting' || status === 'reconnecting';
  });

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.updateConfiguration();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialRotation']) {
      this.rotation.set(this.normalizeRotation(this.initialRotation));
    }

    if (changes['source'] && this.viewReady) this.updateConfiguration();
  }

  ngOnDestroy(): void {
    this.viewReady = false;
    this.clearRetryTimer();
    void this.disposeSession();
  }

  retry(): void {
    if (!this.source) return;

    this.clearRetryTimer();
    this.retryAttempt.set(0);
    void this.connect();
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
    this.retryAttempt.set(0);

    if (!this.source) {
      this.status.set('not-configured');
      void this.disposeSession();
      return;
    }

    void this.connect();
  }

  private async connect(): Promise<void> {
    const source = this.source;
    const video = this.streamVideo?.nativeElement;
    if (!source || !video || !this.viewReady) {
      this.status.set(source ? 'unavailable' : 'not-configured');
      return;
    }

    if (typeof RTCPeerConnection === 'undefined' || typeof window.MediaMTXWebRTCReader !== 'function') {
      this.status.set('unavailable');
      return;
    }

    const generation = ++this.connectionGeneration;
    await this.disposeSession();
    if (generation !== this.connectionGeneration || !this.viewReady) return;

    this.status.set(this.retryAttempt() > 0 ? 'reconnecting' : 'connecting');
    video.srcObject = null;

    const session = new WhepClient({
      onStateChange: (state) => this.onReaderStateChange(generation, state),
    });
    this.session = session;

    try {
      session.connect(source.whepUrl, video);
      if (generation !== this.connectionGeneration || this.session !== session) {
        session.close();
        return;
      }
    } catch {
      if (generation === this.connectionGeneration && this.session === session) {
        this.disposeSession();
        this.scheduleRetry();
      }
    }
  }

  private onReaderStateChange(generation: number, state: WhepReaderState): void {
    if (generation !== this.connectionGeneration || !this.session) return;

    if (state === 'streaming') {
      this.retryAttempt.set(0);
      this.status.set('streaming');
      return;
    }

    if (state === 'reconnecting') {
      this.status.set('reconnecting');
      return;
    }

    this.disposeSession();
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (!this.source || !this.viewReady || this.retryTimer) return;

    const attempt = this.retryAttempt() + 1;
    if (attempt > MAX_RETRY_ATTEMPTS) {
      this.status.set('error');
      return;
    }

    this.retryAttempt.set(attempt);
    this.status.set('reconnecting');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, RETRY_DELAY_MS);
  }

  private async disposeSession(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (session) await session.close();
  }

  private clearRetryTimer(): void {
    if (!this.retryTimer) return;

    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private normalizeRotation(value: number): number {
    return ((value % 360) + 360) % 360;
  }
}
