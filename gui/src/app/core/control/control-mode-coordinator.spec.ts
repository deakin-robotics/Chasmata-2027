import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ArmControlModeService } from './arm/arm-control-mode';
import { ControlCommandPublisher } from './control-command-publisher';
import { ControlModeCoordinator } from './control-mode-coordinator';
import { DriverControlModeService } from './drive/drive-control-mode';
import { ArmMode, DriveMode, FmaColumn, FmaStateService } from '../fma/fma-state.service';
import { RosConnection } from '../ros/ros-connection';
import { RosHeartbeatMonitor } from '../ros/ros-heartbeat-monitor';

describe('ControlModeCoordinator', () => {
  let connected: ReturnType<typeof signal<boolean>>;
  let publishDriveMode: ReturnType<typeof vi.fn>;
  let publishArmMode: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    connected = signal(false);
    const client = signal(null);
    publishDriveMode = vi.fn();
    publishArmMode = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        {
          provide: RosConnection,
          useValue: {
            client: client.asReadonly(),
          },
        },
        {
          provide: RosHeartbeatMonitor,
          useValue: { roverAvailable: connected.asReadonly() },
        },
        {
          provide: ControlCommandPublisher,
          useValue: { publishDriveMode, publishArmMode },
        },
      ],
    });
  });

  it('changes the local mode without creating an FMA request while disconnected', () => {
    const coordinator = TestBed.inject(ControlModeCoordinator);
    const driverControlMode = TestBed.inject(DriverControlModeService);
    const fmaState = TestBed.inject(FmaStateService);

    TestBed.flushEffects();
    coordinator.selectDriveMode(DriveMode.Manual);

    expect(driverControlMode.mode()).toBe(DriveMode.Manual);
    expect(getColumn(fmaState, 'DRIVE')).toEqual({
      label: 'DRIVE',
      confirmed: null,
      commanded: null,
    });
  });

  it('waits for FMA telemetry before initializing a dashboard mode', () => {
    const coordinator = TestBed.inject(ControlModeCoordinator);
    const fmaState = TestBed.inject(FmaStateService);

    TestBed.flushEffects();
    connected.set(true);
    TestBed.flushEffects();

    expect(getColumn(fmaState, 'DRIVE')).toEqual({
      label: 'DRIVE',
      confirmed: null,
      commanded: null,
    });
    expect(getColumn(fmaState, 'ARM')).toEqual({
      label: 'ARM',
      confirmed: null,
      commanded: null,
    });
    expect(publishDriveMode).not.toHaveBeenCalled();
    expect(publishArmMode).not.toHaveBeenCalled();

    coordinator.synchronizeDriveModeFromRover();
    expect(publishDriveMode).toHaveBeenCalledTimes(1);
    expect(publishDriveMode).toHaveBeenCalledWith(DriveMode.Velocity);
    expect(getColumn(fmaState, 'DRIVE')?.commanded).toBe(DriveMode.Velocity);
    expect(publishArmMode).not.toHaveBeenCalled();
  });

  it('adopts a Drive rover mode instead of overwriting it', () => {
    const coordinator = TestBed.inject(ControlModeCoordinator);
    const driverControlMode = TestBed.inject(DriverControlModeService);
    const fmaState = TestBed.inject(FmaStateService);

    connected.set(true);
    fmaState.setDriveTelemetry(DriveMode.Manual, null);

    coordinator.synchronizeDriveModeFromRover();

    expect(driverControlMode.mode()).toBe(DriveMode.Manual);
    expect(publishDriveMode).not.toHaveBeenCalled();
    expect(publishArmMode).not.toHaveBeenCalled();
  });

  it('creates a pending request for a connected mode selection', () => {
    const coordinator = TestBed.inject(ControlModeCoordinator);
    const fmaState = TestBed.inject(FmaStateService);

    connected.set(true);
    TestBed.flushEffects();
    coordinator.selectArmMode(ArmMode.Position);

    expect(getColumn(fmaState, 'ARM')).toEqual({
      label: 'ARM',
      confirmed: null,
      commanded: ArmMode.Position,
    });
  });

  it('does not publish when the selected mode is clicked again', () => {
    const coordinator = TestBed.inject(ControlModeCoordinator);

    connected.set(true);
    TestBed.flushEffects();
    const initialDriveRequests = publishDriveMode.mock.calls.length;
    const initialArmRequests = publishArmMode.mock.calls.length;

    coordinator.selectDriveMode(DriveMode.Velocity);
    coordinator.selectArmMode(ArmMode.Manual);

    expect(publishDriveMode).toHaveBeenCalledTimes(initialDriveRequests);
    expect(publishArmMode).toHaveBeenCalledTimes(initialArmRequests);
  });

  it('preserves shared FMA telemetry on Rover disconnect while preserving local modes', () => {
    const coordinator = TestBed.inject(ControlModeCoordinator);
    const driverControlMode = TestBed.inject(DriverControlModeService);
    const armControlMode = TestBed.inject(ArmControlModeService);
    const fmaState = TestBed.inject(FmaStateService);

    connected.set(true);
    TestBed.flushEffects();
    coordinator.selectDriveMode(DriveMode.Manual);
    coordinator.selectArmMode(ArmMode.Manual);
    fmaState.confirmDriveMode(DriveMode.Manual);
    fmaState.confirmArmMode(ArmMode.Manual);
    coordinator.selectDriveMode(DriveMode.Velocity);

    connected.set(false);
    TestBed.flushEffects();

    expect(driverControlMode.mode()).toBe(DriveMode.Velocity);
    expect(armControlMode.mode()).toBe(ArmMode.Manual);
    expect(getColumn(fmaState, 'DRIVE')).toEqual({
      label: 'DRIVE',
      confirmed: DriveMode.Manual,
      commanded: DriveMode.Velocity,
    });
    expect(getColumn(fmaState, 'ARM')).toEqual({
      label: 'ARM',
      confirmed: ArmMode.Manual,
      commanded: null,
    });
  });

  it('requests an Arm mode after Rover reconnects', () => {
    const coordinator = TestBed.inject(ControlModeCoordinator);
    const fmaState = TestBed.inject(FmaStateService);

    connected.set(true);
    connected.set(false);
    connected.set(true);

    coordinator.requestArmMode(ArmMode.Manual);

    expect(getColumn(fmaState, 'ARM')?.commanded).toBe(ArmMode.Manual);
    expect(publishArmMode).toHaveBeenCalledWith(ArmMode.Manual);
  });
});

function getColumn<T extends 'DRIVE' | 'ARM'>(
  fmaState: FmaStateService,
  label: T,
): Extract<FmaColumn, { label: T }> | undefined {
  return fmaState
    .columns()
    .find((column): column is Extract<FmaColumn, { label: T }> => column.label === label);
}
