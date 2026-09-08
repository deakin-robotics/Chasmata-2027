import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArmControlModeService } from '../../../../../core/control/arm/arm-control-mode';
import { FmaStateService } from '../../../../../core/fma/fma-state.service';
import { ArmModePage } from './mode-page';

describe('ArmModePage', () => {
  let component: ArmModePage;
  let fixture: ComponentFixture<ArmModePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArmModePage],
    }).compileComponents();

    fixture = TestBed.createComponent(ArmModePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should default to Position mode', () => {
    expect(component.armMode()).toBe('POSITION');
    expect(fixture.nativeElement.querySelector('button.active')?.textContent.trim()).toBe(
      'POSITION',
    );
  });

  it('should disable mode selection without ROS connection', () => {
    const buttons = fixture.nativeElement.querySelectorAll(
      'app-control-mode-selector button',
    ) as NodeListOf<HTMLButtonElement>;

    expect([...buttons].every((button) => button.disabled)).toBe(true);
  });

  it('should ignore mode changes without ROS connection', () => {
    const manualButton = fixture.nativeElement.querySelector(
      'app-control-mode-selector button',
    ) as HTMLButtonElement;
    manualButton.click();
    fixture.detectChanges();

    expect(TestBed.inject(ArmControlModeService).mode()).toBe('POSITION');
    expect(
      TestBed.inject(FmaStateService)
        .columns()
        .find((column) => column.label === 'ARM')?.commanded,
    ).toBeNull();
  });
});
