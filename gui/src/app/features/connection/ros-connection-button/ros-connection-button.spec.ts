import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ArmControlModeService } from '../../../core/control/arm/arm-control-mode';
import { ArmMode } from '../../../core/fma/fma-state.service';
import { BaseStationConnection } from '../../../core/ros/base-station-connection';
import { RosConnection, type RosConnectionStatus } from '../../../core/ros/ros-connection';
import { RosHeartbeatMonitor } from '../../../core/ros/ros-heartbeat-monitor';
import { RosConnectionButton } from './ros-connection-button';

describe('RosConnectionButton', () => {
  let fixture: ComponentFixture<RosConnectionButton>;
  let roverConnect: ReturnType<typeof vi.fn>;
  let baseStationConnect: ReturnType<typeof vi.fn>;
  let roverDisconnect: ReturnType<typeof vi.fn>;
  let baseStationDisconnect: ReturnType<typeof vi.fn>;
  let roverStatus: WritableSignal<RosConnectionStatus>;
  let baseStationStatus: WritableSignal<RosConnectionStatus>;
  let roverAvailable: WritableSignal<boolean>;
  let baseStationAvailable: WritableSignal<boolean>;
  let roverWasAvailable: WritableSignal<boolean>;
  let baseStationWasAvailable: WritableSignal<boolean>;
  let resetLinkHistory: ReturnType<typeof vi.fn>;
  let setArmMode: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    roverStatus = signal<RosConnectionStatus>('disconnected');
    baseStationStatus = signal<RosConnectionStatus>('disconnected');
    const connectionInProgress = signal(false);
    roverAvailable = signal(false);
    baseStationAvailable = signal(false);
    roverWasAvailable = signal(false);
    baseStationWasAvailable = signal(false);
    resetLinkHistory = vi.fn(() => {
      roverWasAvailable.set(false);
      baseStationWasAvailable.set(false);
    });
    roverConnect = vi.fn();
    baseStationConnect = vi.fn();
    roverDisconnect = vi.fn();
    baseStationDisconnect = vi.fn();
    setArmMode = vi.fn();

    await TestBed.configureTestingModule({
      imports: [RosConnectionButton],
      providers: [
        {
          provide: RosConnection,
          useValue: {
            status: roverStatus.asReadonly(),
            isConnecting: connectionInProgress.asReadonly(),
            connect: roverConnect,
            disconnect: roverDisconnect,
          },
        },
        {
          provide: BaseStationConnection,
          useValue: {
            status: baseStationStatus.asReadonly(),
            isConnecting: connectionInProgress.asReadonly(),
            connect: baseStationConnect,
            disconnect: baseStationDisconnect,
          },
        },
        {
          provide: RosHeartbeatMonitor,
          useValue: {
            roverAvailable: roverAvailable.asReadonly(),
            baseStationAvailable: baseStationAvailable.asReadonly(),
            roverWasAvailable: roverWasAvailable.asReadonly(),
            baseStationWasAvailable: baseStationWasAvailable.asReadonly(),
            resetLinkHistory,
          },
        },
        {
          provide: ArmControlModeService,
          useValue: { setMode: setArmMode },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RosConnectionButton); fixture.detectChanges();
  });
  it('opens both fixed ROS links without an endpoint dialog', () => {
    expect(fixture.nativeElement.textContent).toContain('ROS Link');
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    expect(roverConnect).toHaveBeenCalledWith('localhost:9090');
    expect(baseStationConnect).toHaveBeenCalledWith('localhost:9091');
  });

  it('closes both ROS links when switched off', () => {
    fixture.componentInstance.setConnected(false);

    expect(setArmMode).toHaveBeenCalledWith(ArmMode.Manual);
    expect(resetLinkHistory).toHaveBeenCalledOnce();
    expect(roverDisconnect).toHaveBeenCalledOnce();
    expect(baseStationDisconnect).toHaveBeenCalledOnce();
  });

  it('is blue and steady while switched off', () => {
    expect(fixture.componentInstance.tone()).toBe('info');
    expect(fixture.componentInstance.flashing()).toBe(false);
  });

  it('flashes blue until both links are online', () => {
    roverStatus.set('connecting');
    baseStationStatus.set('connecting');
    fixture.detectChanges();
    expect(fixture.componentInstance.tone()).toBe('info');
    expect(fixture.componentInstance.flashing()).toBe(true);

    roverStatus.set('connected');
    roverAvailable.set(true);
    roverWasAvailable.set(true);
    fixture.detectChanges();
    expect(fixture.componentInstance.tone()).toBe('info');
    expect(fixture.componentInstance.flashing()).toBe(true);

    baseStationStatus.set('connected');
    baseStationAvailable.set(true);
    baseStationWasAvailable.set(true);
    fixture.detectChanges();
    expect(fixture.componentInstance.tone()).toBe('normal');
    expect(fixture.componentInstance.flashing()).toBe(false);
  });

  it('is amber for one failed link and red when both links fail', () => {
    roverStatus.set('connected');
    baseStationStatus.set('connected');
    roverAvailable.set(true);
    baseStationAvailable.set(true);
    roverWasAvailable.set(true);
    baseStationWasAvailable.set(true);
    fixture.detectChanges();

    roverAvailable.set(false);
    fixture.detectChanges();
    expect(fixture.componentInstance.tone()).toBe('caution');
    expect(fixture.componentInstance.flashing()).toBe(false);

    baseStationAvailable.set(false);
    fixture.detectChanges();
    expect(fixture.componentInstance.tone()).toBe('critical');
  });

  it('is amber when one link fails while the other is still connecting', () => {
    roverStatus.set('error');
    baseStationStatus.set('connecting');
    fixture.detectChanges();

    expect(fixture.componentInstance.tone()).toBe('caution');
    expect(fixture.componentInstance.flashing()).toBe(false);
  });

  it('is red when both links report an error', () => {
    roverStatus.set('error');
    baseStationStatus.set('error');
    fixture.detectChanges();

    expect(fixture.componentInstance.tone()).toBe('critical');
    expect(fixture.componentInstance.flashing()).toBe(false);
  });
});
