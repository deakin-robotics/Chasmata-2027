import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PilotDashboard } from './pilot-dashboard';

describe('PilotDashboard', () => {
  let component: PilotDashboard;
  let fixture: ComponentFixture<PilotDashboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PilotDashboard],
    }).compileComponents();

    fixture = TestBed.createComponent(PilotDashboard);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the rover schematic', () => {
    expect(fixture.nativeElement.querySelector('app-rover-schematic')).toBeTruthy();
  });
});
