import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DriverControlPanel } from './driver-control-panel';

describe('DriverControlPanel', () => {
  let component: DriverControlPanel;
  let fixture: ComponentFixture<DriverControlPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DriverControlPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(DriverControlPanel);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
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

  it('should render the Mode page when its tab is selected', () => {
    const modeTab = fixture.nativeElement.querySelectorAll('.tab-button')[1] as HTMLButtonElement;
    modeTab.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-driver-mode-page')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-control-mode-selector')).toBeTruthy();
  });
});
