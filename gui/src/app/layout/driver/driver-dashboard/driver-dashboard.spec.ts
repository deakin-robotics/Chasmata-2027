import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DriverDashboard } from './driver-dashboard';

describe('DriverDashboard', () => {
  let component: DriverDashboard;
  let fixture: ComponentFixture<DriverDashboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DriverDashboard],
    }).compileComponents();

    fixture = TestBed.createComponent(DriverDashboard);
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

  it('should place the rover schematic and control scheme with the Driver panel', () => {
    expect(fixture.nativeElement.querySelector('app-rover-schematic')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-control-scheme')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-driver-control-panel')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.arm-camera-column app-rover-schematic')).toBeFalsy();
    expect(fixture.nativeElement.querySelector('.arm-camera-column app-control-scheme')).toBeFalsy();
    expect(
      fixture.nativeElement.querySelector('.driver-control-column app-rover-schematic'),
    ).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('.driver-control-column app-control-scheme'),
    ).toBeTruthy();
  });

  it('should render the reserved space in the left column', () => {
    const reserved = fixture.nativeElement.querySelector('.reserved-space');

    expect(reserved?.textContent.trim()).toBe('Reserved');
    expect(fixture.nativeElement.querySelector('.arm-camera-column .reserved-space')).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('.driver-control-column .reserved-space'),
    ).toBeFalsy();
  });

  it('should render the small gamepad overlay', () => {
    expect(fixture.nativeElement.querySelector('app-gamepad-control-panel')).toBeTruthy();
  });
});
