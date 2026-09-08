import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArmMode, DriveMode, FmaStateService } from '../../core/fma/fma-state.service';
import { ControlScheme } from './control-scheme';

describe('ControlScheme', () => {
  let component: ControlScheme;
  let fixture: ComponentFixture<ControlScheme>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ControlScheme],
    }).compileComponents();

    fixture = TestBed.createComponent(ControlScheme);
    component = fixture.componentInstance;
    TestBed.inject(FmaStateService).confirmDriveMode(DriveMode.Manual);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should provide left, center, and right scheme regions', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.mapping-left')).toBeTruthy();
    expect(element.querySelector('.scheme-gamepad')).toBeTruthy();
    expect(element.querySelector('.mapping-right')).toBeTruthy();
  });

  it('should mark both mapping columns unavailable without ROS connection', () => {
    expect(fixture.nativeElement.querySelectorAll('app-unavailable-overlay')).toHaveLength(2);
  });

  it('should render the active driver catalogue mapping', () => {
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Left track');
    expect(text).toContain('Gimbal Priority');
  });

  it('should render the active arm catalogue mapping', () => {
    fixture.componentRef.setInput('context', 'arm');
    TestBed.inject(FmaStateService).confirmArmMode(ArmMode.Manual);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Joint 1');
    expect(text).toContain('Open end-effector');
  });
});
