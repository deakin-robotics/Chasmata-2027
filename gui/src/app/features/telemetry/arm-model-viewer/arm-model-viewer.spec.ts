import { signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { RosHeartbeatMonitor } from '../../../core/ros/ros-heartbeat-monitor';
import { ArmModelScene } from './arm-model-scene/arm-model-scene';
import { ArmModelViewer } from './arm-model-viewer';

describe('ArmModelViewer', () => {
  let fixture: ComponentFixture<ArmModelViewer>;
  let baseStationAvailable: WritableSignal<boolean>;
  let roverAvailable: WritableSignal<boolean>;

  beforeEach(async () => {
    baseStationAvailable = signal(false);
    roverAvailable = signal(false);

    await TestBed.configureTestingModule({
      imports: [ArmModelViewer],
      providers: [
        {
          provide: RosHeartbeatMonitor,
          useValue: {
            baseStationAvailable: baseStationAvailable.asReadonly(),
            roverAvailable: roverAvailable.asReadonly(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArmModelViewer);
    fixture.detectChanges();
  });

  it('keeps the status bar in the wrapper and delegates the scene area', () => {
    expect(fixture.nativeElement.querySelector('[aria-label="Arm 3D model viewer"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.viewer-header')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-arm-model-scene')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.scene-host')).toBeTruthy();
  });

  it('shows Move and IK as disconnected in red when the base station is unavailable', () => {
    roverAvailable.set(true);
    fixture.detectChanges();

    const moveStatus = fixture.nativeElement.querySelector('.execution-status');
    const ikStatus = fixture.nativeElement.querySelector('.ik-status');

    expect(moveStatus?.textContent).toContain('MOVE: DISCONNECTED');
    expect(moveStatus?.classList.contains('execution-status-disconnected')).toBe(true);
    expect(ikStatus?.textContent).toContain('IK: DISCONNECTED');
    expect(ikStatus?.classList.contains('ik-status-disconnected')).toBe(true);
  });

  it('shows Move as disconnected in red when the rover is unavailable', () => {
    baseStationAvailable.set(true);
    fixture.detectChanges();

    const moveStatus = fixture.nativeElement.querySelector('.execution-status');
    const ikStatus = fixture.nativeElement.querySelector('.ik-status');

    expect(moveStatus?.textContent).toContain('MOVE: DISCONNECTED');
    expect(moveStatus?.classList.contains('execution-status-disconnected')).toBe(true);
    expect(ikStatus?.textContent).toContain('IK: WAITING');
    expect(ikStatus?.classList.contains('ik-status-disconnected')).toBe(false);
  });

  it('restores Move status when both heartbeats are available', () => {
    baseStationAvailable.set(true);
    roverAvailable.set(true);
    fixture.detectChanges();

    const moveStatus = fixture.nativeElement.querySelector('.execution-status');
    expect(moveStatus?.textContent).toContain('MOVE: WAITING');
    expect(moveStatus?.classList.contains('execution-status-disconnected')).toBe(false);
  });

  it('reflects scene readiness and telemetry freshness in the 3D status', () => {
    const scene = fixture.debugElement.query(By.directive(ArmModelScene))
      .componentInstance as ArmModelScene;

    scene.status.set('waiting-telemetry');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.viewer-status')?.textContent).toContain(
      '3D: WAITING',
    );
    expect(fixture.nativeElement.querySelector('.viewer-status-waiting')).toBeTruthy();

    scene.status.set('ready');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.viewer-status')?.textContent).toContain(
      '3D: READY',
    );

    scene.telemetryStale.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.viewer-status')?.textContent).toContain(
      '3D: STALE',
    );
    expect(fixture.nativeElement.querySelector('.viewer-status-stale')).toBeTruthy();
  });
});
