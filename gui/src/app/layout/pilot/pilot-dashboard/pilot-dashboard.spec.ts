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

  it('should render the front, arm, and gimbal camera positions', () => {
    const cameras = fixture.nativeElement.querySelectorAll('app-camera-stream');

    expect(cameras).toHaveLength(3);
    expect(fixture.nativeElement.textContent).toContain('Front camera');
    expect(fixture.nativeElement.textContent).toContain('Arm camera');
    expect(fixture.nativeElement.textContent).toContain('Gimbal camera');
  });

  it('should render the rover schematic and Pilot control panel', () => {
    expect(fixture.nativeElement.querySelector('app-rover-schematic')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-control-scheme')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-pilot-control-panel')).toBeTruthy();
  });

  it('should render the small gamepad overlay', () => {
    expect(fixture.nativeElement.querySelector('app-gamepad-control-panel')).toBeTruthy();
  });
});
