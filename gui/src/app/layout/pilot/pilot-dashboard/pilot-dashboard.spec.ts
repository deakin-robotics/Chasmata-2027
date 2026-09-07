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

  it('should render the front camera position', () => {
    const cameras = fixture.nativeElement.querySelectorAll('app-camera-stream');

    expect(cameras).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('Front camera');
    expect(fixture.nativeElement.textContent).not.toContain('Left side camera');
    expect(fixture.nativeElement.textContent).not.toContain('Right side camera');
    expect(fixture.nativeElement.textContent).not.toContain('Rear camera');
  });

  it('should render the controller input overlay', () => {
    expect(fixture.nativeElement.querySelector('app-gamepad-control-panel')).toBeTruthy();
  });
});
