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
  afterEach(() => { fixture.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (window as Window & { MediaMTXWebRTCReader?: unknown }).MediaMTXWebRTCReader; });
});
