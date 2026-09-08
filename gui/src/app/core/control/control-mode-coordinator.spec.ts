import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ArmControlModeService } from './arm/arm-control-mode';
import { ControlModeCoordinator } from './control-mode-coordinator';
import { DriverControlModeService } from './drive/drive-control-mode';
import { ArmMode, DriveMode, FmaStateService } from '../fma/fma-state.service';
import { RosConnection } from '../ros/ros-connection';

describe('ControlModeCoordinator', () => {
  let connected: ReturnType<typeof signal<boolean>>;

  beforeEach(() => {
    connected = signal(false);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: RosConnection,
          useValue: { isConnected: connected.asReadonly() },
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

  it('creates one pending request for the local defaults when connected', () => {
    TestBed.inject(ControlModeCoordinator);
    const fmaState = TestBed.inject(FmaStateService);

    TestBed.flushEffects();
    connected.set(true);
    TestBed.flushEffects();

    expect(getColumn(fmaState, 'DRIVE')).toEqual({
      label: 'DRIVE',
      confirmed: null,
      commanded: DriveMode.Velocity,
    });
    expect(getColumn(fmaState, 'ARM')).toEqual({
      label: 'ARM',
      confirmed: null,
      commanded: ArmMode.Position,
    });

    TestBed.flushEffects();

    expect(getColumn(fmaState, 'DRIVE')?.commanded).toBe(DriveMode.Velocity);
    expect(getColumn(fmaState, 'ARM')?.commanded).toBe(ArmMode.Position);
  });

  it('creates a pending request for a connected mode selection', () => {
    const coordinator = TestBed.inject(ControlModeCoordinator);
    const fmaState = TestBed.inject(FmaStateService);

    connected.set(true);
    TestBed.flushEffects();
    coordinator.selectArmMode(ArmMode.Manual);

    expect(getColumn(fmaState, 'ARM')).toEqual({
      label: 'ARM',
      confirmed: null,
      commanded: ArmMode.Manual,
    });
  });

  it('clears FMA control state on disconnect while preserving local modes', () => {
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
      confirmed: null,
      commanded: null,
    });
    expect(getColumn(fmaState, 'ARM')).toEqual({
      label: 'ARM',
      confirmed: null,
      commanded: null,
    });
  });

  it('re-requests the preserved local modes after reconnecting', () => {
    const coordinator = TestBed.inject(ControlModeCoordinator);
    const fmaState = TestBed.inject(FmaStateService);

    coordinator.selectDriveMode(DriveMode.Manual);
    coordinator.selectArmMode(ArmMode.Manual);
    connected.set(true);
    TestBed.flushEffects();
    connected.set(false);
    TestBed.flushEffects();
    connected.set(true);
    TestBed.flushEffects();

    expect(getColumn(fmaState, 'DRIVE')?.commanded).toBe(DriveMode.Manual);
    expect(getColumn(fmaState, 'ARM')?.commanded).toBe(ArmMode.Manual);
  });
});

function getColumn(fmaState: FmaStateService, label: 'DRIVE' | 'ARM') {
  return fmaState.columns().find((column) => column.label === label);
}
