import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { CAMERA_SOURCES } from '../camera-sources';
import { MediaMTXWebRTCReaderOptions, MediaMTXWebRTCReaderInstance } from './whep-client';
import { CameraStream } from './camera-stream';

class FakeReader implements MediaMTXWebRTCReaderInstance {
  static instances: FakeReader[] = [];
  readonly close = vi.fn();

  constructor(readonly options: MediaMTXWebRTCReaderOptions) {
    FakeReader.instances.push(this);
  }

  emitTrack(): void {
    this.options.onTrack?.({
      streams: [{} as MediaStream],
      track: {} as MediaStreamTrack,
    } as unknown as RTCTrackEvent);
  }

  emitError(error = 'connection failed'): void {
    this.options.onError?.(error);
  }
}

describe('CameraStream', () => {
  let fixture: ComponentFixture<CameraStream>;

  beforeEach(async () => {
    FakeReader.instances = [];
    await TestBed.configureTestingModule({
      imports: [CameraStream],
    }).compileComponents();

    vi.stubGlobal('RTCPeerConnection', class {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          gatewayAvailable: true,
          cameras: { front: true, gimbal: true, arm: true },
        }),
      }),
    );
    Object.defineProperty(window, 'MediaMTXWebRTCReader', {
      configurable: true,
      value: FakeReader,
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      get(this: HTMLMediaElement) {
        return (
          (this as HTMLMediaElement & { testSrcObject?: MediaProvider | null }).testSrcObject ??
          null
        );
      },
      set(this: HTMLMediaElement, value: MediaProvider | null) {
        (this as HTMLMediaElement & { testSrcObject?: MediaProvider | null }).testSrcObject = value;
      },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    fixture = TestBed.createComponent(CameraStream);
    fixture.detectChanges();
  });

  async function reachFailover(
    source = CAMERA_SOURCES.front,
    allowRoverFallback = true,
  ): Promise<void> {
    fixture.componentRef.setInput('source', source);
    fixture.componentRef.setInput('allowRoverFallback', allowRoverFallback);
    fixture.detectChanges();
    await fixture.whenStable();

    FakeReader.instances[0].emitError();
    await vi.advanceTimersByTimeAsync(5_000);
    FakeReader.instances[1].emitError();
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();
    await Promise.resolve();
  }

  it('starts unconfigured without a camera source', () => {
    expect(fixture.componentInstance.status()).toBe('not-configured');
    expect(fixture.nativeElement.textContent).toContain('No camera source configured');
  });

  it('opens the base-station WHEP endpoint first', async () => {
    fixture.componentRef.setInput('source', CAMERA_SOURCES.front);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(FakeReader.instances[0].options.url).toBe(CAMERA_SOURCES.front.whepUrl);
    expect(fixture.nativeElement.querySelectorAll('video')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('img')).toBeFalsy();
  });

  it('closes both gateways while off and reconnects to the base gateway when switched on', async () => {
    vi.useFakeTimers();
    await reachFailover();
    FakeReader.instances[2].emitTrack();
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();

    const readinessChecks = vi.mocked(fetch).mock.calls.length;
    fixture.componentRef.setInput('enabled', false);
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.componentInstance.status()).toBe('off');
    expect(fixture.componentInstance.activeGateway()).toBeNull();
    expect(FakeReader.instances[0].close).toHaveBeenCalledOnce();
    expect(FakeReader.instances[1].close).toHaveBeenCalledOnce();
    expect(FakeReader.instances[2].close).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('app-unavailable-overlay')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.status').textContent).toContain('Off');

    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.resolve();
    expect(FakeReader.instances).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(readinessChecks);

    fixture.componentRef.setInput('enabled', true);
    fixture.detectChanges();
    await Promise.resolve();

    expect(fixture.componentInstance.status()).toBe('connecting');
    expect(FakeReader.instances).toHaveLength(4);
    expect(FakeReader.instances[3].options.url).toBe(CAMERA_SOURCES.front.whepUrl);
  });

  it('fails over after ten seconds and keeps the rover feed while checking recovery in background', async () => {
    vi.useFakeTimers();
    await reachFailover();
    expect(FakeReader.instances).toHaveLength(3);
    FakeReader.instances[2].emitTrack();
    fixture.detectChanges();

    expect(fixture.componentInstance.activeGateway()).toBe('rover');
    expect(fixture.componentInstance.status()).toBe('streaming');
    expect(fetch).toHaveBeenCalledOnce();
    expect(FakeReader.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(10_001);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(FakeReader.instances).toHaveLength(4);
    fixture.detectChanges();

    expect(fixture.componentInstance.activeGateway()).toBe('rover');
    expect(fixture.componentInstance.status()).toBe('streaming');
    expect(FakeReader.instances[3].options.url).toBe(CAMERA_SOURCES.front.whepUrl);
    expect(FakeReader.instances[2].close).not.toHaveBeenCalled();

    FakeReader.instances[3].emitTrack();
    fixture.detectChanges();

    expect(fixture.componentInstance.activeGateway()).toBe('base');
    expect(FakeReader.instances[2].close).toHaveBeenCalledOnce();
  });

  it('does not open a rover session for a bandwidth-restricted camera', async () => {
    vi.useFakeTimers();
    await reachFailover(CAMERA_SOURCES.arm, false);
    fixture.detectChanges();

    expect(FakeReader.instances).toHaveLength(2);
    expect(fixture.componentInstance.activeGateway()).toBeNull();
    expect(fixture.componentInstance.status()).toBe('unavailable');
    expect(fixture.nativeElement.querySelector('app-unavailable-overlay')).toBeTruthy();
  });

  it('keeps the rover picture active if the primary recovery attempt fails', async () => {
    vi.useFakeTimers();
    await reachFailover(CAMERA_SOURCES.gimbal, true);
    FakeReader.instances[2].emitTrack();
    await vi.advanceTimersByTimeAsync(10_001);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(FakeReader.instances).toHaveLength(4);

    FakeReader.instances[3].emitError('recovery failed');
    fixture.detectChanges();

    expect(fixture.componentInstance.activeGateway()).toBe('rover');
    expect(fixture.componentInstance.status()).toBe('streaming');
    expect(FakeReader.instances[2].close).not.toHaveBeenCalled();
    expect(FakeReader.instances[3].close).toHaveBeenCalledOnce();
  });

  it('closes sessions and cancels background checks when destroyed', async () => {
    vi.useFakeTimers();
    await reachFailover();
    FakeReader.instances[2].emitTrack();
    const callsBeforeDestroy = vi.mocked(fetch).mock.calls.length;

    fixture.destroy();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(FakeReader.instances[2].close).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(callsBeforeDestroy);
    expect(FakeReader.instances).toHaveLength(3);
  });

  it('rotates in 90-degree increments', () => {
    const component = fixture.componentInstance;
    component.rotateClockwise();
    component.rotateClockwise();
    component.rotateCounterClockwise();
    expect(component.rotation()).toBe(90);
  });

  it('shows unavailable when WebRTC is not exposed by the browser', async () => {
    vi.stubGlobal('RTCPeerConnection', undefined);
    fixture.componentRef.setInput('source', CAMERA_SOURCES.front);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.status()).toBe('unavailable');
    expect(FakeReader.instances).toHaveLength(0);
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as Window & { MediaMTXWebRTCReader?: unknown }).MediaMTXWebRTCReader;
  });
});
