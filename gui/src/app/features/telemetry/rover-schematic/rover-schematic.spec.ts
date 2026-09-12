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

  it('should hide the arm before telemetry arrives', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(component.actualArmYawDeg()).toBeNull();
    expect(component.actualArmLength()).toBeNull();
    expect(element.querySelector('.arm-actual')).toBeFalsy();
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
    const armYaw = component.actualArmYawDeg();
    const armLength = component.actualArmLength();

    expect(armYaw).not.toBeNull();
    expect(armLength).toBeGreaterThan(0);
    expect(arm?.getAttribute('transform')).toContain(`rotate(${armYaw}`);
    expect(Number.isFinite(Number(line?.getAttribute('y2')))).toBe(true);
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
    const initialLineY2 = Number(
      (fixture.nativeElement as HTMLElement).querySelector('.arm-actual line')?.getAttribute('y2'),
    );
    expect(initialLength).not.toBeNull();
    expect(initialLength ?? 0).toBeGreaterThan(0);

    telemetry.setJointState({
      names: ['base_joint', 'shoulder_joint', 'elbow_joint'],
      positions: [0, 0, Math.PI],
    });
    fixture.detectChanges();
    const updatedLength = component.actualArmLength();
    const updatedLineY2 = Number(
      (fixture.nativeElement as HTMLElement).querySelector('.arm-actual line')?.getAttribute('y2'),
    );
    expect(updatedLength).toBeGreaterThan(initialLength ?? 0);
    expect(updatedLineY2).toBeLessThan(initialLineY2);
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
