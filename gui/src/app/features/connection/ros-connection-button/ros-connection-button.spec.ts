import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
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
  beforeEach(async () => {
    const roverStatus = signal<RosConnectionStatus>('disconnected');
    const baseStationStatus = signal<RosConnectionStatus>('disconnected');
    const connectionInProgress = signal(false);
    const roverAvailable = signal(false);
    const baseStationAvailable = signal(false);
    roverConnect = vi.fn();
    baseStationConnect = vi.fn();
    roverDisconnect = vi.fn();
    baseStationDisconnect = vi.fn();

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
          },
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

    expect(roverDisconnect).toHaveBeenCalledOnce();
    expect(baseStationDisconnect).toHaveBeenCalledOnce();
  });
});
