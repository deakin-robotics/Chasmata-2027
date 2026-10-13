export type WhepReaderState = 'streaming' | 'reconnecting' | 'error';

export interface MediaMTXWebRTCReaderOptions {
  readonly url: string;
  readonly user?: string;
  readonly pass?: string;
  readonly token?: string;
  readonly onError?: (error: string) => void;
  readonly onTrack?: (event: RTCTrackEvent) => void;
  readonly onDataChannel?: (event: RTCDataChannelEvent) => void;
}

export interface MediaMTXWebRTCReaderInstance {
  close(): void;
}

export type MediaMTXWebRTCReaderConstructor = new (
  options: MediaMTXWebRTCReaderOptions,
) => MediaMTXWebRTCReaderInstance;

declare global {
  interface Window {
    MediaMTXWebRTCReader?: MediaMTXWebRTCReaderConstructor;
  }
}

export interface WhepClientOptions {
  readonly readerFactory?: (
    options: MediaMTXWebRTCReaderOptions,
  ) => MediaMTXWebRTCReaderInstance;
  readonly onStateChange?: (state: WhepReaderState, error?: string) => void;
}

/**
 * Thin Angular-facing adapter around MediaMTX's official WebRTC reader.
 *
 * The vendored reader owns WHEP signaling, codec negotiation, trickle ICE,
 * session cleanup, and transport recovery. This adapter only connects reader
 * callbacks to the component's video element and lifecycle.
 */
export class WhepClient {
  private readonly readerFactory: (
    options: MediaMTXWebRTCReaderOptions,
  ) => MediaMTXWebRTCReaderInstance;
  private readonly onStateChange?: (state: WhepReaderState, error?: string) => void;
  private reader: MediaMTXWebRTCReaderInstance | null = null;
  private sessionGeneration = 0;

  constructor(options: WhepClientOptions = {}) {
    this.readerFactory = options.readerFactory ?? ((readerOptions) => {
      if (typeof window === 'undefined' || !window.MediaMTXWebRTCReader) {
        throw new Error('MediaMTX WebRTC reader is unavailable.');
      }

      return new window.MediaMTXWebRTCReader(readerOptions);
    });
    this.onStateChange = options.onStateChange;
  }

  connect(endpoint: string, video: HTMLVideoElement): void {
    this.close();

    const generation = ++this.sessionGeneration;
    let trackReceived = false;
    let reader: MediaMTXWebRTCReaderInstance;

    const isCurrent = (): boolean =>
      generation === this.sessionGeneration && this.reader === reader;

    reader = this.readerFactory({
      url: endpoint,
      onTrack: (event) => {
        if (!isCurrent()) return;

        trackReceived = true;
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        video.srcObject = stream;
        void video.play().catch(() => {
          // Muted autoplay should work, but browsers may still require a gesture.
        });
        this.onStateChange?.('streaming');
      },
      onError: (error) => {
        if (!isCurrent()) return;

        this.onStateChange?.(trackReceived ? 'reconnecting' : 'error', error);
      },
    });

    this.reader = reader;
  }

  close(): void {
    this.sessionGeneration += 1;

    const reader = this.reader;
    this.reader = null;
    reader?.close();
  }
}
