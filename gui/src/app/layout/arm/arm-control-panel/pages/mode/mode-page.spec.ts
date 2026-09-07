import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArmControlModeService } from '../../../../../core/control/arm/arm-control-mode';
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

  it('should update the shared arm mode service', () => {
    const manualButton = fixture.nativeElement.querySelector(
      'app-control-mode-selector button',
    ) as HTMLButtonElement;
    manualButton.click();
    fixture.detectChanges();

    expect(TestBed.inject(ArmControlModeService).mode()).toBe('MANUAL');
  });
});
