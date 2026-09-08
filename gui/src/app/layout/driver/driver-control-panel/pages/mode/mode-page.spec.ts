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

  it('should default to Manual mode', () => {
    expect(component.driveMode()).toBe('MANUAL');
    expect(fixture.nativeElement.querySelector('button.active')?.textContent.trim()).toBe(
      'MANUAL',
    );
  });

  it('should update the shared Driver drive mode service', () => {
    const velocityButton = fixture.nativeElement.querySelectorAll(
      'app-control-mode-selector button',
    )[1] as HTMLButtonElement;
    velocityButton.click();
    fixture.detectChanges();

    expect(TestBed.inject(DriverControlModeService).mode()).toBe('VELOCITY');
    expect(
      TestBed.inject(FmaStateService)
        .columns()
        .find((column) => column.label === 'DRIVE')?.commanded,
    ).toBe(DriveMode.Velocity);
  });
});
