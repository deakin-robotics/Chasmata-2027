import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { CameraStream } from '../../../features/cameras/camera-stream/camera-stream';
import { ArmDashboard } from './arm-dashboard';

describe('ArmDashboard', () => {
  let fixture: ComponentFixture<ArmDashboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArmDashboard],
    }).compileComponents();

    fixture = TestBed.createComponent(ArmDashboard);
    fixture.detectChanges();
  });

  it('should render the Arm dashboard', () => {
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Arm camera');
    expect(text).toContain('Gimbal camera');
    expect(text).toContain('Front camera');
    expect(text).not.toContain('Rear camera');
    expect(text).toContain('Arm model viewer');
    expect(text).not.toContain('Clamp schematic');
    expect(text).toContain('Master Drive');
    const cameraColumn = fixture.nativeElement.querySelector('.arm-camera-column');
    expect(cameraColumn?.querySelector('app-camera-stream')).toBeTruthy();
    expect(cameraColumn?.querySelector('app-arm-model-viewer')).toBeTruthy();
    const schematicColumn = fixture.nativeElement.querySelector('.arm-schematic-column');
    expect(schematicColumn?.querySelector('app-rover-schematic')).toBeTruthy();
    expect(schematicColumn?.querySelector('app-control-scheme')).toBeTruthy();
    expect(schematicColumn?.querySelector('app-gamepad-control-panel')).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('.arm-schematic-column app-arm-model-viewer'),
    ).toBeFalsy();
    expect(
      fixture.nativeElement.querySelector('.arm-operator-column app-arm-model-viewer'),
    ).toBeFalsy();
  });

  it('allows rover fallback for Arm and Gimbal, but not Front', () => {
    const policies = fixture.debugElement
      .queryAll(By.directive(CameraStream))
      .map(({ componentInstance }) => {
        const camera = componentInstance as CameraStream;
        return [camera.label, camera.allowRoverFallback];
      });

    expect(policies).toEqual([
      ['Front camera', false],
      ['Arm camera', true],
      ['Gimbal camera', true],
    ]);
  });

  it('uses the Camera Link switch to toggle all three dashboard tiles together', () => {
    const cameras = fixture.debugElement.queryAll(By.directive(CameraStream));
    const toggle = fixture.nativeElement.querySelector('.camera-feed button') as HTMLButtonElement;

    expect(cameras.map(({ componentInstance }) => (componentInstance as CameraStream).enabled)).toEqual([
      false,
      false,
      false,
    ]);

    toggle.click();
    fixture.detectChanges();
    expect(cameras.map(({ componentInstance }) => (componentInstance as CameraStream).enabled)).toEqual([
      true,
      true,
      true,
    ]);

    toggle.click();
    fixture.detectChanges();
    expect(cameras.map(({ componentInstance }) => (componentInstance as CameraStream).enabled)).toEqual([
      false,
      false,
      false,
    ]);
  });
});
