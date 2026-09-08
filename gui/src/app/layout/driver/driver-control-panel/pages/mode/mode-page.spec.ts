import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DriverControlModeService } from '../../../../../core/control/drive/drive-control-mode';
import { FmaStateService } from '../../../../../core/fma/fma-state.service';
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

  it('should ignore mode changes without ROS connection', () => {
    const manualButton = fixture.nativeElement.querySelectorAll(
      'app-control-mode-selector button',
    )[0] as HTMLButtonElement;
    manualButton.click();
    fixture.detectChanges();

    expect(TestBed.inject(DriverControlModeService).mode()).toBe('VELOCITY');
    expect(
      TestBed.inject(FmaStateService)
        .columns()
        .find((column) => column.label === 'DRIVE')?.commanded,
    ).toBeNull();
  });
});
