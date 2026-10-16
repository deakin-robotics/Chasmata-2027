import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { CAMERA_SOURCES } from '../camera-sources';
import { MediaMTXWebRTCReaderInstance, MediaMTXWebRTCReaderOptions } from './whep-client';
import { CameraStream } from './camera-stream';

class FakeReader implements MediaMTXWebRTCReaderInstance {
  static options: MediaMTXWebRTCReaderOptions[] = [];
  readonly close = vi.fn();
  constructor(options: MediaMTXWebRTCReaderOptions) { FakeReader.options.push(options); }
}

describe('CameraStream', () => {
  let fixture: ComponentFixture<CameraStream>;
  beforeEach(async () => {
    FakeReader.options = [];
    await TestBed.configureTestingModule({ imports: [CameraStream] }).compileComponents();
    vi.stubGlobal('RTCPeerConnection', class {});
    Object.defineProperty(window, 'MediaMTXWebRTCReader', { configurable: true, value: FakeReader });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    fixture = TestBed.createComponent(CameraStream); fixture.detectChanges();
  });
  it('opens only the BaseStation WHEP endpoint', async () => {
    fixture.componentRef.setInput('source', CAMERA_SOURCES.front); fixture.detectChanges(); await fixture.whenStable();
    expect(FakeReader.options).toHaveLength(1);
    expect(FakeReader.options[0].url).toBe(CAMERA_SOURCES.front.whepUrl);
    expect(fixture.nativeElement.querySelectorAll('video')).toHaveLength(1);
  });
  it('keeps retrying an unavailable camera every three seconds', async () => {
    fixture.componentRef.setInput('source', CAMERA_SOURCES.front); fixture.detectChanges(); await fixture.whenStable();
    vi.useFakeTimers();

    for (let attempt = 0; attempt < 11; attempt += 1) {
      FakeReader.options.at(-1)?.onError?.('camera unavailable');
      expect(fixture.componentInstance.status()).toBe('reconnecting');
      vi.advanceTimersByTime(3_000);
    }

    expect(FakeReader.options).toHaveLength(12);
    expect(fixture.componentInstance.retryAttempt()).toBe(11);
  });
  it('keeps a healthy stream visible while frames continue arriving', async () => {
    fixture.componentRef.setInput('source', CAMERA_SOURCES.front); fixture.detectChanges(); await fixture.whenStable();
    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'requestVideoFrameCallback', { configurable: true, value: undefined });
    vi.useFakeTimers();

    FakeReader.options[0].onTrack?.({ streams: [{} as MediaStream] } as unknown as RTCTrackEvent);
    vi.advanceTimersByTime(2_000);
    video.dispatchEvent(new Event('timeupdate'));
    vi.advanceTimersByTime(2_000);
    fixture.detectChanges();

    expect(fixture.componentInstance.status()).toBe('streaming');
    expect(fixture.nativeElement.querySelector('app-unavailable-overlay')).toBeNull();
  });
  it('replaces a stalled frame with the unavailable cross and reconnects', async () => {
    fixture.componentRef.setInput('source', CAMERA_SOURCES.front); fixture.detectChanges(); await fixture.whenStable();
    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'requestVideoFrameCallback', { configurable: true, value: undefined });
    vi.useFakeTimers();

    FakeReader.options[0].onTrack?.({ streams: [{} as MediaStream] } as unknown as RTCTrackEvent);
    vi.advanceTimersByTime(3_000);
    fixture.detectChanges();

    expect(fixture.componentInstance.status()).toBe('reconnecting');
    expect(fixture.componentInstance.streamUnavailable()).toBe(true);
    expect(video.srcObject).toBeNull();
    expect(fixture.nativeElement.querySelector('app-unavailable-overlay')).toBeTruthy();

    vi.advanceTimersByTime(3_000);
    expect(FakeReader.options).toHaveLength(2);
    FakeReader.options[1].onTrack?.({ streams: [{} as MediaStream] } as unknown as RTCTrackEvent);
    video.dispatchEvent(new Event('timeupdate'));
    fixture.detectChanges();

    expect(fixture.componentInstance.streamUnavailable()).toBe(false);
    expect(fixture.nativeElement.querySelector('app-unavailable-overlay')).toBeNull();
  });
  it('cancels a stalled-stream retry when Camera Link is switched off', async () => {
    fixture.componentRef.setInput('source', CAMERA_SOURCES.front); fixture.detectChanges(); await fixture.whenStable();
    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'requestVideoFrameCallback', { configurable: true, value: undefined });
    vi.useFakeTimers();
    FakeReader.options[0].onTrack?.({ streams: [{} as MediaStream] } as unknown as RTCTrackEvent);

    fixture.componentRef.setInput('enabled', false); fixture.detectChanges(); await Promise.resolve(); fixture.detectChanges();
    vi.advanceTimersByTime(6_000);

    expect(fixture.componentInstance.status()).toBe('off');
    expect(FakeReader.options).toHaveLength(1);
  });
  afterEach(() => { fixture.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); delete (window as Window & { MediaMTXWebRTCReader?: unknown }).MediaMTXWebRTCReader; });
});
