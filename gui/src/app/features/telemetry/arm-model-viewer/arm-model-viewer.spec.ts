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

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
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
});
