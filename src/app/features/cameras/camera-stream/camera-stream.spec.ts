import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { CameraStream } from './camera-stream';

describe('CameraStream', () => {
  let component: CameraStream;
  let fixture: ComponentFixture<CameraStream>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CameraStream],
    }).compileComponents();

    fixture = TestBed.createComponent(CameraStream);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create in a not-configured state', () => {
    expect(component).toBeTruthy();
    expect(component.status()).toBe('not-configured');
    expect(component.streamUrl()).toBeNull();
  });

  it('should load a configured stream URL', () => {
    fixture.componentRef.setInput('url', 'http://rover.local:8080/?action=stream');
    fixture.componentRef.setInput('label', 'Front camera');
    fixture.detectChanges();

    expect(component.status()).toBe('loading');
    expect(component.streamUrl()).toContain('http://rover.local:8080/?action=stream');
    expect(fixture.nativeElement.textContent).toContain('Front camera');
  });

  it('should become live after the stream loads', () => {
    fixture.componentRef.setInput('url', 'http://rover.local:8080/?action=stream');
    fixture.detectChanges();

    component.onImageLoad();

    expect(component.status()).toBe('streaming');
    expect(component.retryAttempt()).toBe(0);
  });

  it('should automatically retry after a stream error', () => {
    vi.useFakeTimers();
    fixture.componentRef.setInput('url', 'http://rover.local:8080/?action=stream');
    fixture.detectChanges();

    component.onImageError();

    expect(component.status()).toBe('reconnecting');
    expect(component.retryAttempt()).toBe(1);

    vi.advanceTimersByTime(1_000);

    expect(component.status()).toBe('loading');
  });

  it('should rotate in 90-degree increments', () => {
    component.rotateClockwise();
    component.rotateClockwise();
    component.rotateCounterClockwise();

    expect(component.rotation()).toBe(90);
  });
});
