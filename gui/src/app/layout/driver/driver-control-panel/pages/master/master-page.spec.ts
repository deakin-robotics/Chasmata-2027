import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';

import { DriverControlModeService } from '../../../../../core/control/drive/drive-control-mode';
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

  beforeEach(async () => {
    roverAvailable = signal(false);
    roverWasAvailable = signal(false);
    roverConnectionStatus = signal<RosConnectionStatus>('disconnected');
    const baseStationAvailable = signal(false);
    const baseStationWasAvailable = signal(false);
    const baseStationConnectionStatus = signal<RosConnectionStatus>('disconnected');
    const connectionInProgress = signal(false);

    await TestBed.configureTestingModule({
      imports: [DriverMasterPage],
      providers: [
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
