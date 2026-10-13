import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { ArmModelScene } from './arm-model-scene/arm-model-scene';
import { ArmModelViewer } from './arm-model-viewer';

describe('ArmModelViewer', () => {
  let fixture: ComponentFixture<ArmModelViewer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArmModelViewer],
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

  it('reflects scene readiness and telemetry freshness in the 3D status', () => {
    const scene = fixture.debugElement.query(By.directive(ArmModelScene))
      .componentInstance as ArmModelScene;

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
