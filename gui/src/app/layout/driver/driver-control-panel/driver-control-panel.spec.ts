import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DriverControlPanel } from './driver-control-panel';

describe('DriverControlPanel', () => {
  let fixture: ComponentFixture<DriverControlPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DriverControlPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(DriverControlPanel);
    fixture.detectChanges();
  });

  it('should render the Master Drive switch', () => {
    expect(fixture.nativeElement.querySelector('app-control-switch')).toBeTruthy();
  });

  it('should render the ROS Link action', () => {
    expect(fixture.nativeElement.querySelector('app-action-button')).toBeTruthy();
  });

  it('should render the read-only Gamepad status', () => {
    expect(fixture.nativeElement.querySelector('app-status-indicator')).toBeTruthy();
  });

  it('should label the active tab Master', () => {
    expect(fixture.nativeElement.querySelector('.active-tab')?.textContent.trim()).toBe('Master');
  });

  it('should only expose the Master tab', () => {
    expect(fixture.nativeElement.querySelectorAll('.tab-button')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('app-control-mode-selector')).toBeTruthy();
  });
});
