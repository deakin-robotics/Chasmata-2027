import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EcamSystemDisplay } from './ecam-system-display';
import { DriveTelemetryService } from '../../../core/drive/drive-telemetry.service';
import { ArmTelemetryService } from '../../../core/arm/telemetry/arm-telemetry.service';

describe('EcamSystemDisplay', () => {
  let component: EcamSystemDisplay;
  let fixture: ComponentFixture<EcamSystemDisplay>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EcamSystemDisplay],
    }).compileComponents();

    fixture = TestBed.createComponent(EcamSystemDisplay);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the DRIVE schematic by default', () => {
    expect(component.selectedPage()).toBe('DRIVE');
    expect(fixture.nativeElement.textContent).toContain('FL -- rad/s');
  });

  it('switches to the selected symbolic system page', () => {
    const armButton = fixture.nativeElement.querySelector(
      'button[aria-label="System page: ARM"]',
    ) as HTMLButtonElement;

    armButton.click();
    fixture.detectChanges();

    expect(component.selectedPage()).toBe('ARM');
    expect(fixture.nativeElement.textContent).toContain('MAX MOTOR TEMP');
    expect(fixture.nativeElement.textContent).not.toContain('FAULT');
  });

  it('renders drive measurements and arm planner state from telemetry', () => {
    const drive = TestBed.inject(DriveTelemetryService);
    drive.setCurrent([0, 52]);
    drive.setOdometry({ pose: { pose: { position: { x: 2.5 } } }, twist: { twist: { linear: { x: 0.3 } } } });
    drive.setLinearCommand({ twist: { linear: { x: 0.4 } } });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('I 52 RAW');
    expect(fixture.nativeElement.textContent).toContain('0.40 m/s');
    expect(fixture.nativeElement.textContent).toContain('2.50 m');
    const arm = TestBed.inject(ArmTelemetryService);
    arm.setPlanner('PLANNING');
    component.selectPage({ name: 'ARM' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('PLANNING');
  });
});
