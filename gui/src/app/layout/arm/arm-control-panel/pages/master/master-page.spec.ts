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
  });
});
