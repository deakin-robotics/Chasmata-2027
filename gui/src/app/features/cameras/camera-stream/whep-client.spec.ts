import { vi } from 'vitest';

import {
  MediaMTXWebRTCReaderOptions,
  WhepClient,
  WhepReaderState,
} from './whep-client';

class FakeReader {
  readonly close = vi.fn();

  constructor(readonly options: MediaMTXWebRTCReaderOptions) {}

  emitTrack(stream: MediaStream): void {
    this.options.onTrack?.({
      streams: [stream],
      track: {} as MediaStreamTrack,
    } as unknown as RTCTrackEvent);
  }

  emitError(error: string): void {
    this.options.onError?.(error);
  }
}

describe('WhepClient', () => {
  let video: HTMLVideoElement;

  beforeEach(() => {
    video = document.createElement('video');
    Object.defineProperty(video, 'srcObject', {
      configurable: true,
      writable: true,
      value: null,
    });
    vi.spyOn(video, 'play').mockResolvedValue(undefined);
  });

  it('creates the official reader with the configured WHEP endpoint', () => {
    let reader!: FakeReader;
    const readerFactory = vi.fn((options: MediaMTXWebRTCReaderOptions) => {
      reader = new FakeReader(options);
      return reader;
    });

    const client = new WhepClient({ readerFactory });
    client.connect('http://localhost:8889/front/whep', video);

    expect(readerFactory).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://localhost:8889/front/whep' }),
    );
    expect(reader).toBeDefined();
  });

  it('attaches the remote track and reports the live state', () => {
    let reader!: FakeReader;
    const onStateChange: (state: WhepReaderState, error?: string) => void = vi.fn();
    const client = new WhepClient({
      readerFactory: (options) => {
        reader = new FakeReader(options);
        return reader;
      },
      onStateChange,
    });
    const stream = {} as MediaStream;

    client.connect('http://localhost:8889/front/whep', video);
    reader.emitTrack(stream);

    expect(video.srcObject).toBe(stream);
    expect(video.play).toHaveBeenCalledOnce();
    expect(onStateChange).toHaveBeenCalledWith('streaming');
  });

  it('reports initial errors and transport errors as different states', () => {
    let reader!: FakeReader;
    const onStateChange: (state: WhepReaderState, error?: string) => void = vi.fn();
    const client = new WhepClient({
      readerFactory: (options) => {
        reader = new FakeReader(options);
        return reader;
      },
      onStateChange,
    });

    client.connect('http://localhost:8889/front/whep', video);
    reader.emitError('stream not found');

    expect(onStateChange).toHaveBeenLastCalledWith('error', 'stream not found');

    client.connect('http://localhost:8889/front/whep', video);
    const stream = {} as MediaStream;
    reader.emitTrack(stream);
    reader.emitError('peer connection closed');

    expect(onStateChange).toHaveBeenLastCalledWith('reconnecting', 'peer connection closed');
  });

  it('closes the official reader on cleanup', () => {
    let reader!: FakeReader;
    const client = new WhepClient({
      readerFactory: (options) => {
        reader = new FakeReader(options);
        return reader;
      },
    });

    client.connect('http://localhost:8889/front/whep', video);
    client.close();

    expect(reader.close).toHaveBeenCalledOnce();
  });
});
