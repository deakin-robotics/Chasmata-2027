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

  it('should render the Arm dashboard placeholders', () => {
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Arm camera');
    expect(text).toContain('Front camera');
    expect(text).toContain('Rear camera');
    expect(text).toContain('Arm schematic');
    expect(text).toContain('Clamp schematic');
    expect(text).toContain('Master Drive');
  });
});
