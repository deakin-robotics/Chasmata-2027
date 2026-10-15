import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ControlModeCoordinator } from '../../../../../core/control/control-mode-coordinator';
import { ArmMode } from '../../../../../core/fma/fma-state.service';
import { RosHeartbeatMonitor } from '../../../../../core/ros/ros-heartbeat-monitor';
import { ArmMasterPage } from './master-page';

describe('ArmMasterPage', () => {
  let fixture: ComponentFixture<ArmMasterPage>;
  let baseStationAvailable: ReturnType<typeof signal<boolean>>;
  let roverAvailable: ReturnType<typeof signal<boolean>>;
  let selectArmMode: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    baseStationAvailable = signal(false);
    roverAvailable = signal(false);
    const roverStatus = signal('disconnected');
    const isRoverConnecting = signal(false);
    selectArmMode = vi.fn();

    await TestBed.configureTestingModule({
      imports: [ArmMasterPage],
      providers: [
        {
          provide: RosHeartbeatMonitor,
          useValue: {
            baseStationAvailable: baseStationAvailable.asReadonly(),
            roverAvailable: roverAvailable.asReadonly(),
            roverStatus: roverStatus.asReadonly(),
            isRoverConnecting: isRoverConnecting.asReadonly(),
          },
        },
        {
          provide: ControlModeCoordinator,
          useValue: { selectArmMode },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArmMasterPage);
    fixture.detectChanges();
  });

  it('should render the Master page controls', () => {
    expect(fixture.nativeElement.textContent).toContain('Master Drive');
    expect(fixture.nativeElement.textContent).toContain('Rover Link');
    expect(fixture.nativeElement.textContent).toContain('BaseStation Link');
    expect(fixture.nativeElement.textContent).toContain('Camera Link');
    expect(
      fixture.nativeElement.querySelector('.camera-feed button').getAttribute('aria-checked'),
    ).toBe('false');
    expect(fixture.nativeElement.textContent).toContain('Law Override');
    expect(fixture.nativeElement.textContent).toContain('Clear Faults');
    expect(
      fixture.nativeElement.querySelector('app-control-mode-selector.arm-mode-selector'),
    ).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.law-override button').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('.clear-faults button').disabled).toBe(true);
  });

  it('should enable the camera feed when switched on', () => {
    const button = fixture.nativeElement.querySelector('.camera-feed button') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.cameraFeedEnabled()).toBe(true);
    expect(button.getAttribute('aria-checked')).toBe('true');
  });

  it('falls back to Manual when created while the BaseStation is unavailable', () => {
    expect(selectArmMode).toHaveBeenCalledOnce();
    expect(selectArmMode).toHaveBeenCalledWith(ArmMode.Manual);
  });

  it('falls back to Manual and disables the mode selector until the heartbeat returns', () => {
    selectArmMode.mockClear();
    roverAvailable.set(true);
    baseStationAvailable.set(true);
    fixture.detectChanges();
    expect(selectArmMode).not.toHaveBeenCalled();
    const selector = fixture.nativeElement.querySelector('.arm-mode-selector');
    const selectorControl = selector.querySelector('.control-mode-selector');
    const modeButtons = selector.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    expect(selectorControl.getAttribute('aria-disabled')).toBe('false');
    expect([...modeButtons].every((button) => !button.disabled)).toBe(true);

    baseStationAvailable.set(false);
    fixture.detectChanges();

    expect(selectArmMode).toHaveBeenCalledOnce();
    expect(selectArmMode).toHaveBeenCalledWith(ArmMode.Manual);
    expect(selectorControl.getAttribute('aria-disabled')).toBe('true');
    expect([...modeButtons].every((button) => button.disabled)).toBe(true);

    baseStationAvailable.set(true);
    fixture.detectChanges();
    expect(selectArmMode).toHaveBeenCalledOnce();
    expect(selectorControl.getAttribute('aria-disabled')).toBe('false');
    expect([...modeButtons].every((button) => !button.disabled)).toBe(true);
  });
});
