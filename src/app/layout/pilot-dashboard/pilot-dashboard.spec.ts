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

  it('should render the front, side, and rear camera positions', () => {
    const cameras = fixture.nativeElement.querySelectorAll('app-camera-stream');

    expect(cameras).toHaveLength(4);
    expect(fixture.nativeElement.textContent).toContain('Front camera');
    expect(fixture.nativeElement.textContent).toContain('Left side camera');
    expect(fixture.nativeElement.textContent).toContain('Right side camera');
    expect(fixture.nativeElement.textContent).toContain('Rear camera');
  });

  it('should render the bird\'s-eye view panel', () => {
    expect(fixture.nativeElement.querySelector('app-bird-view')).toBeTruthy();
  });
});
