import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArmDashboard } from './arm-dashboard';

describe('ArmDashboard', () => {
  let component: ArmDashboard;
  let fixture: ComponentFixture<ArmDashboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArmDashboard],
    }).compileComponents();

    fixture = TestBed.createComponent(ArmDashboard);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the Arm workspace placeholder', () => {
    expect(fixture.nativeElement.textContent).toContain('Arm workspace');
  });
});
