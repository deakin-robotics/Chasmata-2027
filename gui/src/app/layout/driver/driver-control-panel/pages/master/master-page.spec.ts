import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';

import { DriverControlModeService } from '../../../../../core/control/drive/drive-control-mode';
import { DriverControl } from '../../../../../core/control/drive/driver-control';
import { GamepadInput } from '../../../../../core/gamepad/gamepad-input';
import { DriveMode, FmaStateService } from '../../../../../core/fma/fma-state.service';
import { BaseStationConnection } from '../../../../../core/ros/base-station-connection';
import { RosConnection, type RosConnectionStatus } from '../../../../../core/ros/ros-connection';
import { RosHeartbeatMonitor } from '../../../../../core/ros/ros-heartbeat-monitor';
import { DriverMasterPage } from './master-page';

describe('DriverMasterPage', () => {
  let component: DriverMasterPage;
  let fixture: ComponentFixture<DriverMasterPage>;
  let roverAvailable: WritableSignal<boolean>;
  let roverWasAvailable: WritableSignal<boolean>;
  let roverConnectionStatus: WritableSignal<RosConnectionStatus>;
  let gamepadConnected: WritableSignal<boolean>;
  let baseStationAvailable: WritableSignal<boolean>;

  beforeEach(async () => {
    roverAvailable = signal(false);
    roverWasAvailable = signal(false);
    roverConnectionStatus = signal<RosConnectionStatus>('disconnected');
    gamepadConnected = signal(true);
    baseStationAvailable = signal(false);
    const baseStationWasAvailable = signal(false);
    const baseStationConnectionStatus = signal<RosConnectionStatus>('disconnected');
    const connectionInProgress = signal(false);

    await TestBed.configureTestingModule({
      imports: [DriverMasterPage],
      providers: [
        { provide: GamepadInput, useValue: {
          start: vi.fn(), stop: vi.fn(), connected: gamepadConnected.asReadonly(),
          snapshot: signal({ axes: [0, 0, 0, 0], buttons: [] }).asReadonly(),
          name: signal<string | null>(null).asReadonly(),
        } },
        {
          provide: RosHeartbeatMonitor,
          useValue: {
            roverAvailable: roverAvailable.asReadonly(),
            roverWasAvailable: roverWasAvailable.asReadonly(),
            baseStationAvailable: baseStationAvailable.asReadonly(),
            baseStationWasAvailable: baseStationWasAvailable.asReadonly(),
            resetLinkHistory: vi.fn(),
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
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DriverMasterPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should render the Driver master controls', () => {
    expect(fixture.nativeElement.textContent).toContain('Master Drive');
    expect(fixture.nativeElement.textContent).toContain('ROS Link');
    expect(fixture.nativeElement.textContent).toContain('Camera Link');
    expect(fixture.nativeElement.textContent).toContain('Rover');
    expect(fixture.nativeElement.textContent).not.toContain('Base Station');
    expect(
      fixture.nativeElement.querySelector('.camera-feed button').getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      fixture.nativeElement.querySelector('app-control-mode-selector.drive-mode-selector'),
    ).toBeTruthy();
  });

  it('should default to Velocity mode', () => {
    expect(component.driveMode()).toBe(DriveMode.Velocity);
    expect(
      fixture.nativeElement
        .querySelector('app-control-mode-selector button.active')
        ?.textContent.trim(),
    ).toBe(DriveMode.Velocity);
  });

  it('should enable the camera feed when switched on', () => {
    const button = fixture.nativeElement.querySelector('.camera-feed button') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    expect(component.cameraFeedEnabled()).toBe(true);
    expect(button.getAttribute('aria-checked')).toBe('true');
  });

  it('keeps Master Drive on and changes its ring during connection loss', () => {
    roverAvailable.set(true);
    baseStationAvailable.set(true);
    expect(TestBed.inject(DriverControl).enable()).toBe(true);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button[aria-label="Master Drive"]') as HTMLButtonElement;
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.classList.contains('tone-normal')).toBe(true);
    baseStationAvailable.set(false);
    fixture.detectChanges();
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.classList.contains('tone-caution')).toBe(true);
    baseStationAvailable.set(true);
    roverAvailable.set(false);
    fixture.detectChanges();
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.disabled).toBe(false);
    expect(button.classList.contains('tone-critical')).toBe(true);
    roverAvailable.set(true);
    gamepadConnected.set(false);
    fixture.detectChanges();
    expect(button.classList.contains('tone-critical')).toBe(true);
    gamepadConnected.set(true);
    fixture.detectChanges();
    expect(button.classList.contains('tone-normal')).toBe(true);
    button.click();
    expect(TestBed.inject(DriverControl).enabled()).toBe(false);
  });

  it('should disable mode selection without ROS connection', () => {
    const buttons = fixture.nativeElement.querySelectorAll(
      'app-control-mode-selector button',
    ) as NodeListOf<HTMLButtonElement>;

    expect([...buttons].every((button) => button.disabled)).toBe(true);
  });

  it('should change only the local mode without ROS connection', () => {
    component.selectDriveMode(DriveMode.Manual);

    expect(TestBed.inject(DriverControlModeService).mode()).toBe(DriveMode.Manual);
    expect(
      TestBed.inject(FmaStateService)
        .columns()
        .find((column) => column.label === 'DRIVE')?.commanded,
    ).toBeNull();
  });

  it('reports the Rover lifecycle from connecting through a lost heartbeat', () => {
    roverConnectionStatus.set('connecting');
    fixture.detectChanges();
    expect(component.roverTopologyStatus()).toEqual({ label: 'Connecting', tone: 'info' });
    expect(fixture.nativeElement.querySelector('.rover-status .status-spinner')).toBeTruthy();

    roverConnectionStatus.set('connected');
    fixture.detectChanges();
    expect(component.roverTopologyStatus()).toEqual({ label: 'Awaiting', tone: 'info' });
    expect(fixture.nativeElement.querySelector('.rover-status .status-spinner')).toBeTruthy();

    roverAvailable.set(true);
    roverWasAvailable.set(true);
    fixture.detectChanges();
    expect(component.roverTopologyStatus()).toEqual({ label: 'Online', tone: 'normal' });

    roverAvailable.set(false);
    fixture.detectChanges();
    expect(component.roverTopologyStatus()).toEqual({ label: 'Lost', tone: 'critical' });
    expect(fixture.nativeElement.querySelector('.rover-status .status-spinner')).toBeTruthy();
    expect(component.roverFlowTone()).toBe('critical');
  });

  it('reports a Rover ROSbridge error as lost', () => {
    roverConnectionStatus.set('error');
    fixture.detectChanges();

    expect(component.roverTopologyStatus()).toEqual({ label: 'Lost', tone: 'critical' });
  });
});
