import { ComponentFixture, TestBed } from '@angular/core/testing';

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

  it('should render the model viewer shell', () => {
    expect(fixture.nativeElement.querySelector('[aria-label="Arm 3D model viewer"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.scene-host')).toBeTruthy();
  });

  it('should show the unavailable overlay without rendering while ROS is disconnected', () => {
    expect(fixture.componentInstance.rosConnected()).toBe(false);
    expect(fixture.componentInstance.ikStatus()).toBe('idle');
    expect(fixture.nativeElement.querySelector('app-unavailable-overlay')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.viewer-status')?.textContent).toContain(
      '3D: UNAVAILABLE',
    );
    expect(fixture.nativeElement.querySelector('.ik-status')?.textContent).toContain('IK: —');
    expect(fixture.nativeElement.querySelector('.orientation-mode-status')?.textContent).toContain(
      'MODE: —',
    );
    expect(fixture.nativeElement.querySelector('.viewer-status-error')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('canvas')).toBeFalsy();
  });

  it('should show a telemetry spinner without rendering the digital twin', () => {
    fixture.componentInstance.status.set('waiting-telemetry');
    fixture.componentInstance.statusMessage.set('Waiting for arm telemetry');
    fixture.detectChanges();

    expect(fixture.componentInstance.viewerStatusLabel()).toBe('WAITING FOR TELEMETRY');
    expect(fixture.nativeElement.querySelector('.viewer-waiting')?.textContent).toContain(
      'Waiting for arm telemetry',
    );
    expect(fixture.nativeElement.querySelector('canvas')).toBeFalsy();
  });

  it('should hide the target marker when the actual marker reaches it', () => {
    let distance = 0.01;
    const viewer = fixture.componentInstance as unknown as {
      targetMarker: {
        visible: boolean;
        position: { distanceTo: (other: unknown) => number };
        material: { opacity: number };
      } | null;
      actualMarker: { position: object } | null;
      updateTargetMarkerVisibility: () => void;
      animateTargetMarker: (now?: number) => void;
      targetMarkerFadeStartedAtMs: number | null;
    };

    viewer.targetMarker = {
      visible: true,
      position: { distanceTo: () => distance },
      material: { opacity: 1 },
    };
    viewer.actualMarker = { position: {} };

    viewer.updateTargetMarkerVisibility();
    expect(viewer.targetMarker.visible).toBe(true);
    expect(viewer.targetMarker.material.opacity).toBe(1);

    const fadeStartedAtMs = viewer.targetMarkerFadeStartedAtMs ?? 0;
    viewer.animateTargetMarker(fadeStartedAtMs + 125);
    expect(viewer.targetMarker.material.opacity).toBeCloseTo(0.5);

    viewer.animateTargetMarker(fadeStartedAtMs + 250);
    expect(viewer.targetMarker.material.opacity).toBe(0);
    expect(viewer.targetMarker.visible).toBe(false);

    distance = 0.03;
    viewer.updateTargetMarkerVisibility();
    expect(viewer.targetMarker.visible).toBe(true);

    const fadeInStartedAtMs = viewer.targetMarkerFadeStartedAtMs ?? 0;
    viewer.animateTargetMarker(fadeInStartedAtMs + 50);
    expect(viewer.targetMarker.material.opacity).toBeCloseTo(0.5);

    viewer.animateTargetMarker(fadeInStartedAtMs + 100);
    expect(viewer.targetMarker.material.opacity).toBeCloseTo(1);
  });
});
