import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DriverControlModeService } from '../../../../../core/control/drive/drive-control-mode';
import { DriveMode, FmaStateService } from '../../../../../core/fma/fma-state.service';
import { DriverMasterPage } from './master-page';

describe('DriverMasterPage', () => {
  let component: DriverMasterPage;
  let fixture: ComponentFixture<DriverMasterPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DriverMasterPage],
    }).compileComponents();

    fixture = TestBed.createComponent(DriverMasterPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should render the Driver master controls', () => {
    expect(fixture.nativeElement.textContent).toContain('Master Drive');
    expect(fixture.nativeElement.textContent).toContain('ROS Link');
    expect(fixture.nativeElement.querySelector('app-control-mode-selector.drive-mode-selector'))
      .toBeTruthy();
  });

  it('should default to Velocity mode', () => {
    expect(component.driveMode()).toBe(DriveMode.Velocity);
    expect(fixture.nativeElement.querySelector('button.active')?.textContent.trim()).toBe(
      DriveMode.Velocity,
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
