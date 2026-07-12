import {
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

export type CameraStreamStatus =
  | 'not-configured'
  | 'loading'
  | 'streaming'
  | 'reconnecting'
  | 'error';

const RETRY_DELAY_MS = 5_000;
const MAX_RETRY_ATTEMPTS = 10; // Max attempts before giving up
const LOAD_TIMEOUT_MS = 10_000; // Max wait for stream to load before giving up

/**
 * Displays and recovers one HTTP/MJPEG camera stream.
 *
 * The parent dashboard supplies the camera identity and URL. This component is
 * deliberately unaware of whether it represents a front, rear, side, or arm
 * camera so it can be reused in both operator views.
 */
@Component({
  selector: 'app-camera-stream',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './camera-stream.html',
  styleUrl: './camera-stream.scss',
})
export class CameraStream implements OnChanges, OnDestroy {
  @Input() label = 'Camera';
  @Input() url = '';
  @Input() initialRotation = 0; // The initial rotation of the camera in degree. In case the camera is mounted upside down

  @ViewChild('streamFrame') private streamFrame?: ElementRef<HTMLElement>;

  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  readonly status = signal<CameraStreamStatus>('not-configured');
  readonly retryAttempt = signal(0);
  readonly rotation = signal(0);
  readonly streamUrl = signal<string | null>(null);
  readonly isFullscreen = signal(false);

  readonly statusLabel = computed(() => {
    switch (this.status()) {
      case 'loading':
        return 'Loading';
      case 'streaming':
        return 'Live';
      case 'reconnecting':
        return 'Reconnecting';
      case 'error':
        return 'Offline';
      default:
        return 'Not configured';
    }
  });

  readonly statusIcon = computed(() => {
    switch (this.status()) {
      case 'loading':
      case 'reconnecting':
        return 'sync';
      case 'streaming':
        return 'videocam';
      case 'error':
        return 'videocam_off';
      default:
        return 'videocam_off';
    }
  });

  readonly isConnecting = computed(() => {
    const status = this.status();
    return status === 'loading' || status === 'reconnecting';
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialRotation']) {
      this.rotation.set(this.normalizeRotation(this.initialRotation));
    }

    if (changes['url']) {
      this.retryAttempt.set(0);
      this.beginLoading();
    }
  }

  ngOnDestroy(): void {
    this.clearTimers();
  }

  onImageLoad(): void {
    this.clearLoadTimer();
    this.retryAttempt.set(0);
    this.status.set('streaming');
  }

  onImageError(): void {
    this.clearLoadTimer();
    this.scheduleRetry();
  }

  retry(): void {
    this.clearTimers();
    this.retryAttempt.set(0);
    this.beginLoading();
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

    if (frame.requestFullscreen) {
      await frame.requestFullscreen();
    }
  }

  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    this.isFullscreen.set(document.fullscreenElement === this.streamFrame?.nativeElement);
  }

  /** Starts a fresh stream request and its load-timeout watchdog. */
  private beginLoading(): void {
    const url = this.url.trim();
    this.clearTimers();

    if (!url) {
      this.streamUrl.set(null);
      this.status.set('not-configured');
      return;
    }

    this.status.set('loading');
    this.streamUrl.set(this.withCacheBuster(url));
    this.loadTimer = setTimeout(() => this.onLoadTimeout(), LOAD_TIMEOUT_MS);
  }

  private onLoadTimeout(): void {
    if (this.status() !== 'loading') return;

    this.scheduleRetry();
  }

  /** Schedules the next stream load attempt after a fixed delay. */
  private scheduleRetry(): void {
    if (!this.url.trim()) {
      this.status.set('not-configured');
      return;
    }

    const previousAttempt = this.retryAttempt();
    if (previousAttempt >= MAX_RETRY_ATTEMPTS) {
      this.streamUrl.set(null);
      this.status.set('error');
      return;
    }

    this.clearTimers();
    this.retryAttempt.set(previousAttempt + 1);
    this.status.set('reconnecting');
    this.retryTimer = setTimeout(() => this.beginLoading(), RETRY_DELAY_MS);
  }

  /** Cancels any pending stream-load timeout and reconnect retry. */
  private clearTimers(): void {
    this.clearLoadTimer();

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** Cancels only the timeout that detects a stream which never loads. */
  private clearLoadTimer(): void {
    if (this.loadTimer) {
      clearTimeout(this.loadTimer);
      this.loadTimer = null;
    }
  }

  /** Adds a changing query value so browsers request a fresh stream URL. */
  private withCacheBuster(url: string): string {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}_retry=${Date.now()}_${this.retryAttempt()}`;
  }

  /** Keeps a rotation value within the standard 0–359 degree range. */
  private normalizeRotation(rotation: number): number {
    return ((rotation % 360) + 360) % 360;
  }
}
