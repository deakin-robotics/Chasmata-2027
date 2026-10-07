import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { CAMERA_SOURCES } from '../camera-sources';
import { CameraStream } from './camera-stream';

describe('CameraStream', () => {
  let fixture: ComponentFixture<CameraStream>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CameraStream],
    }).compileComponents();

    fixture = TestBed.createComponent(CameraStream);
    fixture.detectChanges();
  });

  it('starts unconfigured without a camera source', () => {
    const component = fixture.componentInstance;

    expect(component.status()).toBe('not-configured');
    expect(fixture.nativeElement.textContent).toContain('No camera source configured');
  });

  it('renders a WHEP source without depending on ROSbridge', () => {
    fixture.componentRef.setInput('source', CAMERA_SOURCES.front);
    fixture.componentRef.setInput('label', 'Front camera');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Front camera');
    expect(fixture.nativeElement.querySelector('video')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('img')).toBeFalsy();
  });

  it('rotates in 90-degree increments', () => {
    const component = fixture.componentInstance;

    component.rotateClockwise();
    component.rotateClockwise();
    component.rotateCounterClockwise();

    expect(component.rotation()).toBe(90);
  });

  it('shows the unavailable state when WebRTC is not exposed by the test environment', async () => {
    fixture.componentRef.setInput('source', CAMERA_SOURCES.front);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.status()).toBe('unavailable');
  });

  afterEach(() => {
    vi.useRealTimers();
    fixture.destroy();
  });
});
