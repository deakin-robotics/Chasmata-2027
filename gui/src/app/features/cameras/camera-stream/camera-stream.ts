import { AfterViewInit, Component, ElementRef, HostListener, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, computed, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { UnavailableOverlay } from '../../../shared/unavailable-overlay/unavailable-overlay';
import { CameraSource } from '../camera-sources';
import { WhepClient, WhepReaderState } from './whep-client';

export type CameraStreamStatus = 'not-configured' | 'connecting' | 'streaming' | 'reconnecting' | 'error' | 'off';
const RETRY_DELAY_MS = 3_000;
const FRAME_STALL_TIMEOUT_MS = 3_000;

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/** Displays one BaseStation-hosted WHEP camera stream. */
@Component({ selector: 'app-camera-stream', imports: [MatButtonModule, MatIconModule, UnavailableOverlay], templateUrl: './camera-stream.html', styleUrl: './camera-stream.scss' })
export class CameraStream implements AfterViewInit, OnChanges, OnDestroy {
  @Input() label = 'Camera';
  @Input() source: CameraSource | null = null;
  @Input() initialRotation = 0;
  @Input() enabled = true;
  @ViewChild('streamFrame') private streamFrame?: ElementRef<HTMLElement>;
  @ViewChild('video') private video?: ElementRef<HTMLVideoElement>;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private session: WhepClient | null = null;
  private generation = 0;
  private viewReady = false;
  private configurationGeneration = 0;
  private retryCount = 0;
  private frameWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private frameCallbackVideo: FrameCallbackVideo | null = null;
  private frameCallbackHandle: number | null = null;
  private fallbackVideo: HTMLVideoElement | null = null;
  readonly status = signal<CameraStreamStatus>('not-configured');
  readonly retryAttempt = signal(0);
  readonly rotation = signal(0);
  readonly isFullscreen = signal(false);
  readonly streamUnavailable = signal(false);
  readonly isConnecting = computed(() => ['connecting', 'reconnecting'].includes(this.status()));
  readonly statusLabel = computed(() => ({ connecting: 'Connecting', streaming: 'Live', reconnecting: 'Reconnecting', error: 'Offline', off: 'Off', 'not-configured': 'Not configured' })[this.status()]);
  readonly statusIcon = computed(() => this.isConnecting() ? 'sync' : this.status() === 'streaming' ? 'videocam' : 'videocam_off');

  ngAfterViewInit(): void { this.viewReady = true; this.updateConfiguration(); }
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialRotation']) this.rotation.set(this.normalizeRotation(this.initialRotation));
    if ((changes['source'] || changes['enabled']) && this.viewReady) {
      const generation = ++this.configurationGeneration;
      queueMicrotask(() => { if (generation === this.configurationGeneration && this.viewReady) this.updateConfiguration(); });
    }
  }
  ngOnDestroy(): void { this.viewReady = false; this.clearRetryTimer(); this.closeSession(); }
  retry(): void { this.updateConfiguration(); }
  rotateClockwise(): void { this.rotation.update((value) => this.normalizeRotation(value + 90)); }
  rotateCounterClockwise(): void { this.rotation.update((value) => this.normalizeRotation(value - 90)); }
  async toggleFullscreen(): Promise<void> {
    const frame = this.streamFrame?.nativeElement;
    if (!frame) return;
    if (document.fullscreenElement === frame) await document.exitFullscreen(); else await frame.requestFullscreen?.();
  }
  @HostListener('document:fullscreenchange') onFullscreenChange(): void { this.isFullscreen.set(document.fullscreenElement === this.streamFrame?.nativeElement); }

  private updateConfiguration(): void {
    this.clearRetryTimer(); this.closeSession(); this.retryCount = 0; this.retryAttempt.set(0); this.streamUnavailable.set(false);
    if (!this.source) { this.status.set('not-configured'); return; }
    if (!this.enabled) { this.status.set('off'); return; }
    if (typeof RTCPeerConnection === 'undefined' || typeof window.MediaMTXWebRTCReader !== 'function') { this.status.set('error'); return; }
    this.connect(false);
  }
  private connect(reconnecting: boolean): void {
    const source = this.source; const video = this.video?.nativeElement;
    if (!source || !video || !this.viewReady || !this.enabled) return;
    this.closeSession(); const generation = ++this.generation; this.status.set(reconnecting ? 'reconnecting' : 'connecting');
    this.session = new WhepClient({ onStateChange: (state) => this.onReaderState(generation, state) });
    try { this.session.connect(source.whepUrl, video); } catch { this.onReaderState(generation, 'error'); }
  }
  private onReaderState(generation: number, state: WhepReaderState): void {
    if (generation !== this.generation || !this.session) return;
    if (state === 'streaming') {
      this.retryCount = 0; this.retryAttempt.set(0); this.clearRetryTimer(); this.status.set('streaming'); this.startFrameWatchdog(generation); return;
    }
    this.scheduleRecovery(generation);
  }
  private startFrameWatchdog(generation: number): void {
    this.clearFrameWatchdog();
    const video = this.video?.nativeElement;
    if (!video || generation !== this.generation) return;

    this.armFrameWatchdog(generation);
    const frameCallbackVideo = video as FrameCallbackVideo;
    if (frameCallbackVideo.requestVideoFrameCallback) {
      this.frameCallbackVideo = frameCallbackVideo;
      const observeFrame = () => {
        if (generation !== this.generation || this.frameCallbackVideo !== frameCallbackVideo) return;
        this.noteFrame(generation);
        this.frameCallbackHandle = frameCallbackVideo.requestVideoFrameCallback!(observeFrame);
      };
      this.frameCallbackHandle = frameCallbackVideo.requestVideoFrameCallback(observeFrame);
      return;
    }

    this.fallbackVideo = video;
    video.addEventListener('timeupdate', this.onFallbackFrame);
  }
  private readonly onFallbackFrame = (): void => {
    this.noteFrame(this.generation);
  };
  private noteFrame(generation: number): void {
    if (generation !== this.generation || !this.session) return;
    this.streamUnavailable.set(false);
    this.armFrameWatchdog(generation);
  }
  private armFrameWatchdog(generation: number): void {
    if (this.frameWatchdogTimer) clearTimeout(this.frameWatchdogTimer);
    this.frameWatchdogTimer = setTimeout(() => {
      this.frameWatchdogTimer = null;
      if (generation !== this.generation || !this.session) return;
      this.streamUnavailable.set(true);
      this.scheduleRecovery(generation);
    }, FRAME_STALL_TIMEOUT_MS);
  }
  private scheduleRecovery(generation: number): void {
    if (generation !== this.generation || !this.session || this.retryTimer) return;
    this.closeSession(generation);
    this.retryCount += 1; this.retryAttempt.set(this.retryCount); this.status.set('reconnecting');
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.connect(true); }, RETRY_DELAY_MS);
  }
  private closeSession(expectedGeneration?: number): void {
    if (expectedGeneration !== undefined && expectedGeneration !== this.generation) return;
    this.clearFrameWatchdog();
    this.generation += 1; this.session?.close(); this.session = null;
    if (this.video) this.video.nativeElement.srcObject = null;
  }
  private clearRetryTimer(): void { if (this.retryTimer) clearTimeout(this.retryTimer); this.retryTimer = null; }
  private clearFrameWatchdog(): void {
    if (this.frameWatchdogTimer) clearTimeout(this.frameWatchdogTimer);
    this.frameWatchdogTimer = null;
    if (this.frameCallbackVideo && this.frameCallbackHandle !== null) {
      this.frameCallbackVideo.cancelVideoFrameCallback?.(this.frameCallbackHandle);
    }
    this.frameCallbackVideo = null;
    this.frameCallbackHandle = null;
    this.fallbackVideo?.removeEventListener('timeupdate', this.onFallbackFrame);
    this.fallbackVideo = null;
  }
  private normalizeRotation(value: number): number { return ((value % 360) + 360) % 360; }
}
