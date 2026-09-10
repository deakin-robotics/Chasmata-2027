import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArmDashboard } from './arm-dashboard';

describe('ArmDashboard', () => {
  let component: ArmDashboard;
  let fixture: ComponentFixture<ArmDashboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArmDashboard],
    }).compileComponents();

    fixture = TestBed.createComponent(ArmDashboard);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
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
});
