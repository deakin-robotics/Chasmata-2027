import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArmTelemetryService } from '../../../core/arm/telemetry/arm-telemetry.service';
import { RoverSchematic } from './rover-schematic';

describe('RoverSchematic', () => {
  let component: RoverSchematic;
  let fixture: ComponentFixture<RoverSchematic>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RoverSchematic],
    }).compileComponents();

    fixture = TestBed.createComponent(RoverSchematic);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create with no arm before telemetry arrives', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(component).toBeTruthy();
    expect((element.querySelector('svg') as SVGElement).getAttribute('viewBox')).toBe(
      '-20 18 360 330',
    );
    expect(component.commandedGimbalYawDeg()).toBe(90);
    expect(component.actualGimbalYawDeg()).toBe(0);
    expect(component.actualArmYawDeg()).toBeNull();
    expect(component.actualArmLength()).toBeNull();
    expect(element.querySelector('.arm-actual')).toBeFalsy();
    expect(element.querySelector('.direction-line')).toBeFalsy();
    expect(element.querySelector('.front-chevron')).toBeFalsy();
    expect(element.querySelectorAll('.front-wheel-direction')).toHaveLength(4);
  });

  it('should render the green arm using telemetry angle and length', () => {
    const telemetry = TestBed.inject(ArmTelemetryService);
    telemetry.setJointState({
      names: ['base_joint', 'shoulder_joint', 'elbow_joint'],
      positions: [Math.PI / 2, 0, 0],
    });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const arm = element.querySelector('.arm-actual');
    const line = element.querySelector('.arm-actual line');

    expect(component.actualArmYawDeg()).toBeCloseTo(-128.6598);
    expect(component.actualArmLength()).toBeCloseTo(19.2094);
    expect(arm?.getAttribute('transform')).toContain('rotate(-128.6598');
    expect(Number(line?.getAttribute('y2'))).toBeCloseTo(145.7906);
    expect(line?.getAttribute('x2')).toBe('160');
    expect(element.querySelector('.arm-pivot')).toBeTruthy();
    expect(element.querySelector('.arm-commanded')).toBeFalsy();
  });

  it('should change the arm length when shoulder or elbow telemetry changes', () => {
    const telemetry = TestBed.inject(ArmTelemetryService);

    telemetry.setJointState({
      names: ['base_joint', 'shoulder_joint', 'elbow_joint'],
      positions: [0, 0, 0],
    });
    fixture.detectChanges();
    const initialLength = component.actualArmLength();
    expect(initialLength).toBeCloseTo(19.2094);

    telemetry.setJointState({
      names: ['base_joint', 'shoulder_joint', 'elbow_joint'],
      positions: [0, 0, Math.PI],
    });
    fixture.detectChanges();
    expect(component.actualArmLength()).toBeGreaterThan(initialLength ?? 0);
  });

  it('should keep the existing static clamp shape at the live endpoint', () => {
    const telemetry = TestBed.inject(ArmTelemetryService);
    telemetry.setJointState({
      names: ['base_joint', 'shoulder_joint', 'elbow_joint'],
      positions: [0, 0, 0],
    });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.arm-clamp')?.getAttribute('d')).toBe(
      'M151 67L160 80L169 67',
    );
    const clampTransform = element.querySelector('.arm-actual > g')?.getAttribute('transform') ?? '';
    const clampTranslation = clampTransform.match(/translate\(0 (-?\d+(?:\.\d+)?)/)?.[1];
    expect(Number.parseFloat(clampTranslation ?? 'NaN')).toBeCloseTo(65.7906);
  });

  it('should hide the arm for incomplete telemetry and after disconnect', () => {
    const telemetry = TestBed.inject(ArmTelemetryService);
    const element = fixture.nativeElement as HTMLElement;

    telemetry.setJointState({ names: ['base_joint', 'shoulder_joint'], positions: [0, 0] });
    fixture.detectChanges();
    expect(element.querySelector('.arm-actual')).toBeFalsy();

    telemetry.setJointState({
      names: ['base_joint', 'shoulder_joint', 'elbow_joint'],
      positions: [0, 0, 0],
    });
    fixture.detectChanges();
    expect(element.querySelector('.arm-actual')).toBeTruthy();

    telemetry.clear();
    fixture.detectChanges();
    expect(element.querySelector('.arm-actual')).toBeFalsy();
    expect(component.actualArmYawDeg()).toBeNull();
    expect(component.actualArmLength()).toBeNull();
  });
});
