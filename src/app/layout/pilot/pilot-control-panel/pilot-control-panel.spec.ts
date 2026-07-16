import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PilotControlPanel } from './pilot-control-panel';

describe('PilotControlPanel', () => {
  let component: PilotControlPanel;
  let fixture: ComponentFixture<PilotControlPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PilotControlPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(PilotControlPanel);
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
    expect(fixture.nativeElement.querySelector('.gamepad-status')).toBeTruthy();
  });
});
