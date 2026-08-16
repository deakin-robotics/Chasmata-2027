import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArmControlPanel } from './arm-control-panel';

describe('ArmControlPanel', () => {
  let component: ArmControlPanel;
  let fixture: ComponentFixture<ArmControlPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArmControlPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(ArmControlPanel);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the control panel placeholder', () => {
    expect(fixture.nativeElement.textContent).toContain('Master Drive');
  });
});
