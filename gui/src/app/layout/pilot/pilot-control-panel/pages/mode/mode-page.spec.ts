import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PilotDriveModeService } from '../../../../../core/control/pilot/pilot-drive-mode';
import { DriveMode, FmaStateService } from '../../../../../core/fma/fma-state.service';
import { PilotModePage } from './mode-page';

describe('PilotModePage', () => {
  let component: PilotModePage;
  let fixture: ComponentFixture<PilotModePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PilotModePage],
    }).compileComponents();

    fixture = TestBed.createComponent(PilotModePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should default to Manual mode', () => {
    expect(component.driveMode()).toBe('MANUAL');
    expect(fixture.nativeElement.querySelector('button.active')?.textContent.trim()).toBe(
      'MANUAL',
    );
  });

  it('should update the shared Pilot drive mode service', () => {
    const velocityButton = fixture.nativeElement.querySelectorAll(
      'app-control-mode-selector button',
    )[1] as HTMLButtonElement;
    velocityButton.click();
    fixture.detectChanges();

    expect(TestBed.inject(PilotDriveModeService).mode()).toBe('VELOCITY');
    expect(
      TestBed.inject(FmaStateService)
        .columns()
        .find((column) => column.label === 'DRIVE')?.commanded,
    ).toBe(DriveMode.Velocity);
  });
});
