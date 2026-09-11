import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArmMasterPage } from './master-page';

describe('ArmMasterPage', () => {
  let component: ArmMasterPage;
  let fixture: ComponentFixture<ArmMasterPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArmMasterPage],
    }).compileComponents();

    fixture = TestBed.createComponent(ArmMasterPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the Master page controls', () => {
    expect(fixture.nativeElement.textContent).toContain('Master Drive');
    expect(fixture.nativeElement.textContent).toContain('ROS Link');
    expect(fixture.nativeElement.textContent).toContain('Law Override');
    expect(fixture.nativeElement.textContent).toContain('Clear Faults');
    expect(fixture.nativeElement.querySelector('app-control-mode-selector.arm-mode-selector')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.law-override button').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('.clear-faults button').disabled).toBe(true);
  });
});
