import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriveTelemetryService } from './drive-telemetry.service';
import { ArmTelemetryService } from '../arm/telemetry/arm-telemetry.service';

describe('DriveTelemetryService', () => {
  afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); });

  it('keeps finite wheel speeds and expires them when updates stop', () => {
    vi.useFakeTimers();
    const service = TestBed.inject(DriveTelemetryService);
    service.setJointState(['front_left_wheel_joint', 'rear_left_wheel_joint'], [1.5, Number.NaN]);
    expect(service.wheelVelocities()).toEqual({ front_left_wheel_joint: 1.5 });
    vi.advanceTimersByTime(1500);
    expect(service.wheelVelocities()).toBeNull();
  });

  it('clears wheel data on disconnect', () => {
    const service = TestBed.inject(DriveTelemetryService);
    service.setJointState(['front_left_wheel_joint'], [0]);
    service.clear();
    expect(service.wheelVelocities()).toBeNull();
  });

  it('tracks commanded and measured values independently', () => {
    vi.useFakeTimers();
    const service = TestBed.inject(DriveTelemetryService);
    service.setJointState(['front_left_wheel_joint'], [0.5]);
    service.setCommands(['front_left_wheel_joint'], [1.0]);
    expect(service.wheelVelocities()?.['front_left_wheel_joint']).toBe(0.5);
    expect(service.wheelCommands()?.['front_left_wheel_joint']).toBe(1.0);
    vi.advanceTimersByTime(1500);
    expect(service.wheelCommands()).toBeNull();
  });

  it('expires raw wheel temperatures independently', () => {
    vi.useFakeTimers();
    const service = TestBed.inject(DriveTelemetryService);
    service.setTemperature([0, 42]);
    expect(service.rawTemperatures()[0]).toBe(42);
    vi.advanceTimersByTime(10000);
    expect(service.rawTemperatures()[0]).toBeUndefined();
  });

  it('tracks current and odometry with independent expiration', () => {
    vi.useFakeTimers();
    const service = TestBed.inject(DriveTelemetryService);
    service.setCurrent([1, 52]);
    service.setOdometry({ pose: { pose: { position: { x: 2.5 } } }, twist: { twist: { linear: { x: 0.3 } } } });
    service.setLinearCommand({ twist: { linear: { x: 0.4 } } });
    expect(service.rawCurrents()[1]).toBe(52);
    expect(service.odometry()).toEqual({ x: 2.5, speed: 0.3 });
    expect(service.linearCommand()).toBe(0.4);
    vi.advanceTimersByTime(1500);
    expect(service.odometry()).toBeNull();
    expect(service.linearCommand()).toBeNull();
    expect(service.rawCurrents()[1]).toBe(52);
    vi.advanceTimersByTime(8500);
    expect(service.rawCurrents()[1]).toBeUndefined();
  });
});

describe('ArmTelemetryService freshness', () => {
  afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); });

  it('expires joint samples and clears missing velocities', () => {
    vi.useFakeTimers();
    const service = TestBed.inject(ArmTelemetryService);
    service.setJointState({ names: ['base_joint'], positions: [1], velocities: [2] });
    service.setJointState({ names: ['base_joint'], positions: [1.5] });
    expect(service.actualJointVelocities()).toBeNull();
    expect(service.actualJointAngles()).toEqual({ base_joint: 1.5 });
    vi.advanceTimersByTime(1000);
    expect(service.actualJointAngles()).toBeNull();
  });

  it('expires motor temperature and current separately', () => {
    vi.useFakeTimers();
    const service = TestBed.inject(ArmTelemetryService);
    service.setMotorStatus(1, 42, -1.2);
    expect(service.motors()[1]).toEqual({ temperature: 42, current: -1.2 });
    vi.advanceTimersByTime(2500);
    expect(service.motors()[1]).toBeUndefined();
  });

  it('maps direct commands to configured joints and expires them', () => {
    vi.useFakeTimers();
    const service = TestBed.inject(ArmTelemetryService);
    service.setJointMapping(['base_joint'], [4]);
    service.setCommand(4, 2, 3.5);
    expect(service.commandFor('base_joint')).toEqual({ mode: 2, value: 3.5 });
    vi.advanceTimersByTime(1500);
    expect(service.commandFor('base_joint')).toBeUndefined();
  });

  it('clears completed trajectory commands and retains independent direct commands', () => {
    const service = TestBed.inject(ArmTelemetryService);
    service.setJointMapping(['base_joint'], [1]);
    service.setCommand(1, 2, 3);
    service.setTrajectory(['base_joint'], [Math.PI / 2]);
    expect(service.commandFor('base_joint')?.value).toBeCloseTo(90);
    service.setTrajectory([], []);
    expect(service.commandFor('base_joint')).toEqual({ mode: 2, value: 3 });
  });
});
