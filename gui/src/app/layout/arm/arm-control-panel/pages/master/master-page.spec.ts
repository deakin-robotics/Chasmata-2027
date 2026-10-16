import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { ControlModeCoordinator } from '../../../../../core/control/control-mode-coordinator';
import { ArmMode } from '../../../../../core/fma/fma-state.service';
import { BaseStationConnection } from '../../../../../core/ros/base-station-connection';
import { RosConnection, type RosConnectionStatus } from '../../../../../core/ros/ros-connection';
import { RosHeartbeatMonitor } from '../../../../../core/ros/ros-heartbeat-monitor';
import { ArmMasterPage } from './master-page';

describe('ArmMasterPage', () => {
  let fixture: ComponentFixture<ArmMasterPage>;
  let baseStationAvailable: ReturnType<typeof signal<boolean>>;
  let roverAvailable: ReturnType<typeof signal<boolean>>;
  let roverConnectionStatus: WritableSignal<RosConnectionStatus>;
  let baseStationConnectionStatus: WritableSignal<RosConnectionStatus>;
  let selectArmMode: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    baseStationAvailable = signal(false);
    roverAvailable = signal(false);
    roverConnectionStatus = signal<RosConnectionStatus>('disconnected');
    baseStationConnectionStatus = signal<RosConnectionStatus>('disconnected');
    const roverStatus = signal('disconnected');
    const isRoverConnecting = signal(false);
    const connectionInProgress = signal(false);
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
          provide: RosConnection,
          useValue: {
            client: signal(null).asReadonly(),
            status: roverConnectionStatus.asReadonly(),
            isConnecting: connectionInProgress.asReadonly(),
            connect: vi.fn(),
            disconnect: vi.fn(),
          },
        },
        {
          provide: BaseStationConnection,
          useValue: {
            status: baseStationConnectionStatus.asReadonly(),
            isConnecting: connectionInProgress.asReadonly(),
            connect: vi.fn(),
            disconnect: vi.fn(),
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
    expect(fixture.nativeElement.textContent).toContain('ROS Link');
    expect(fixture.nativeElement.textContent).toContain('Camera Link');
    expect(fixture.nativeElement.textContent).toContain('Gamepad');
    expect(fixture.nativeElement.textContent).toContain('Rover');
    expect(fixture.nativeElement.textContent).toContain('Base Station');
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

  it('reports the Rover lifecycle from connecting through a lost heartbeat', () => {
    roverConnectionStatus.set('connecting');
    fixture.detectChanges();
    expect(fixture.componentInstance.roverTopologyStatus()).toEqual({
      label: 'Connecting',
      tone: 'info',
    });

    roverConnectionStatus.set('connected');
    fixture.detectChanges();
    expect(fixture.componentInstance.roverTopologyStatus()).toEqual({
      label: 'Awaiting',
      tone: 'caution',
    });

    roverAvailable.set(true);
    fixture.detectChanges();
    expect(fixture.componentInstance.roverTopologyStatus()).toEqual({
      label: 'Online',
      tone: 'normal',
    });

    roverAvailable.set(false);
    fixture.detectChanges();
    expect(fixture.componentInstance.roverTopologyStatus()).toEqual({
      label: 'Lost',
      tone: 'critical',
    });

    roverConnectionStatus.set('disconnected');
    fixture.detectChanges();
    expect(fixture.componentInstance.roverTopologyStatus()).toEqual({
      label: 'Off',
      tone: 'neutral',
    });
  });

  it('reports BaseStation heartbeat loss and connection errors independently', () => {
    baseStationConnectionStatus.set('connected');
    fixture.detectChanges();
    expect(fixture.componentInstance.baseStationTopologyStatus()).toEqual({
      label: 'Awaiting',
      tone: 'caution',
    });

    baseStationAvailable.set(true);
    fixture.detectChanges();
    expect(fixture.componentInstance.baseStationTopologyStatus()).toEqual({
      label: 'Online',
      tone: 'normal',
    });

    baseStationAvailable.set(false);
    fixture.detectChanges();
    expect(fixture.componentInstance.baseStationTopologyStatus()).toEqual({
      label: 'Lost',
      tone: 'critical',
    });

    baseStationConnectionStatus.set('error');
    fixture.detectChanges();
    expect(fixture.componentInstance.baseStationTopologyStatus()).toEqual({
      label: 'Error',
      tone: 'critical',
    });
  });

  it('matches the Rover and BaseStation connector tones to their status nodes', () => {
    roverConnectionStatus.set('connected');
    baseStationConnectionStatus.set('connected');
    roverAvailable.set(true);
    baseStationAvailable.set(true);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.rover-flow')).componentInstance.tone()).toBe('normal');
    expect(fixture.debugElement.query(By.css('.base-station-stem')).componentInstance.tone()).toBe(
      'normal',
    );
    expect(fixture.debugElement.query(By.css('.base-station-flow')).componentInstance.tone()).toBe(
      'normal',
    );
  });

  it('falls back to Manual and disables the mode selector until the heartbeat returns', () => {
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
