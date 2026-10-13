import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { vi } from 'vitest';

import { RosConnection } from '../../../core/ros/ros-connection';
import { CameraStream } from './camera-stream';

describe('CameraStream', () => {
  let component: CameraStream;
  let fixture: ComponentFixture<CameraStream>;
  let rosConnected: WritableSignal<boolean>;

  beforeEach(async () => {
    rosConnected = signal(false);

    await TestBed.configureTestingModule({
      imports: [CameraStream],
      providers: [
        {
          provide: RosConnection,
          useValue: { isConnected: rosConnected.asReadonly() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CameraStream);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create as unavailable while ROS is disconnected', () => {
    expect(component).toBeTruthy();
    expect(component.status()).toBe('unavailable');
    expect(component.streamUrl()).toBeNull();
    expect(fixture.nativeElement.querySelector('app-unavailable-overlay')).toBeTruthy();
  });

  it('should wait for ROS before loading a configured stream URL', () => {
    fixture.componentRef.setInput('url', 'http://rover.local:8080/?action=stream');
    fixture.componentRef.setInput('label', 'Front camera');
    fixture.detectChanges();

    expect(component.status()).toBe('unavailable');
    expect(component.streamUrl()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Front camera');

    rosConnected.set(true);
    fixture.detectChanges();

    expect(component.status()).toBe('loading');
    expect(component.streamUrl()).toContain('http://rover.local:8080/?action=stream');
  });

  it('should become live after the stream loads', () => {
    rosConnected.set(true);
    fixture.componentRef.setInput('url', 'http://rover.local:8080/?action=stream');
    fixture.detectChanges();

    component.onImageLoad();

    expect(component.status()).toBe('streaming');
    expect(component.retryAttempt()).toBe(0);
  });

  it('should automatically retry after a stream error', () => {
    vi.useFakeTimers();
    rosConnected.set(true);
    fixture.componentRef.setInput('url', 'http://rover.local:8080/?action=stream');
    fixture.detectChanges();

    component.onImageError();

    expect(component.status()).toBe('reconnecting');
    expect(component.retryAttempt()).toBe(1);

    vi.advanceTimersByTime(5_000);

    expect(component.status()).toBe('loading');
  });

  it('should rotate in 90-degree increments', () => {
    component.rotateClockwise();
    component.rotateClockwise();
    component.rotateCounterClockwise();

    expect(component.rotation()).toBe(90);
  });
});
