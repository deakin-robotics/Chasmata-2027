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

const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_ATTEMPTS = 10;
const LOAD_TIMEOUT_MS = 10_000;

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

    const delay = Math.min(
      INITIAL_RETRY_DELAY_MS * 2 ** previousAttempt,
      MAX_RETRY_DELAY_MS,
    );

    this.clearTimers();
    this.retryAttempt.set(previousAttempt + 1);
    this.status.set('reconnecting');
    this.retryTimer = setTimeout(() => this.beginLoading(), delay);
  }

  private clearTimers(): void {
    this.clearLoadTimer();

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private clearLoadTimer(): void {
    if (this.loadTimer) {
      clearTimeout(this.loadTimer);
      this.loadTimer = null;
    }
  }

  private withCacheBuster(url: string): string {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}_retry=${Date.now()}_${this.retryAttempt()}`;
  }

  private normalizeRotation(rotation: number): number {
    return ((rotation % 360) + 360) % 360;
  }
}
