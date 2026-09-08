import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DriverMasterPage } from './master-page';

describe('DriverMasterPage', () => {
  let component: DriverMasterPage;
  let fixture: ComponentFixture<DriverMasterPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DriverMasterPage],
    }).compileComponents();

    fixture = TestBed.createComponent(DriverMasterPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the Driver master controls', () => {
    expect(fixture.nativeElement.textContent).toContain('Master Drive');
    expect(fixture.nativeElement.textContent).toContain('ROS Link');
  });
});
