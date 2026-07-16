import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { MissionControl } from './mission-control';

describe('MissionControl', () => {
  let component: MissionControl;
  let fixture: ComponentFixture<MissionControl>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MissionControl],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(MissionControl);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render shared mission-control chrome', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toContain('Mission Control');
    expect(element.textContent).toContain('ROS disconnected');
    expect(element.textContent).toContain('ECAM');
    expect(element.textContent).toContain('E-stop');
  });

  it('should show a non-interactive ROS connection status', () => {
    expect(fixture.nativeElement.querySelector('.connection-status')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.connection-status button')).toBeNull();
  });
});
