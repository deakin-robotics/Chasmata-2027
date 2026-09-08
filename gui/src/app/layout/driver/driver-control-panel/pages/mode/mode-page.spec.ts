import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DriverControlModeService } from '../../../../../core/control/drive/drive-control-mode';
import { DriveMode, FmaStateService } from '../../../../../core/fma/fma-state.service';
import { DriverModePage } from './mode-page';

describe('DriverModePage', () => {
  let component: DriverModePage;
  let fixture: ComponentFixture<DriverModePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DriverModePage],
    }).compileComponents();

    fixture = TestBed.createComponent(DriverModePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should default to Velocity mode', () => {
    expect(component.driveMode()).toBe('VELOCITY');
    expect(fixture.nativeElement.querySelector('button.active')?.textContent.trim()).toBe(
      'VELOCITY',
    );
  });

  it('should disable mode selection without ROS connection', () => {
    const buttons = fixture.nativeElement.querySelectorAll(
      'app-control-mode-selector button',
    ) as NodeListOf<HTMLButtonElement>;

    expect([...buttons].every((button) => button.disabled)).toBe(true);
  });

  it('should change only the local mode without ROS connection', () => {
    component.selectDriveMode(DriveMode.Manual);

    expect(TestBed.inject(DriverControlModeService).mode()).toBe(DriveMode.Manual);
    expect(
      TestBed.inject(FmaStateService)
        .columns()
        .find((column) => column.label === 'DRIVE')?.commanded,
    ).toBeNull();
  });
});
