import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ArmTelemetryService } from '../arm/telemetry/arm-telemetry.service';
import { ArmOverrideCommand, ArmOverrideState } from '../control/arm/arm-override';
import { ArmMode, DriveMode, FmaStateService, LawMode } from '../fma/fma-state.service';
import { RosConnection } from './ros-connection';
import { RosHeartbeatMonitor } from './ros-heartbeat-monitor';
import { RosTelemetryBridge } from './ros-telemetry-bridge';

describe('RosTelemetryBridge', () => {
  it('keeps LAW and Arm Override telemetry independent', () => {
    const connected = signal(false);
    const client = signal(null);

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
        ArmTelemetryService,
      ],
    });

    const bridge = TestBed.inject(RosTelemetryBridge);
    const fmaState = TestBed.inject(FmaStateService);
    const handleFmaMessage = (
      bridge as unknown as { handleFmaMessage(message: unknown): void }
    ).handleFmaMessage.bind(bridge);

    handleFmaMessage({
      schema: 'dcr/fma-state/v1',
      sequence: 1,
      drive: { confirmed: 'VELOCITY', pending: '', rejected: '' },
      arm: { confirmed: 'POSITION', pending: '', rejected: '' },
      law: 'DIRECT',
      arm_override: { state: 'INACTIVE', pending: 'ENABLE' },
      system: 'GOOD',
      gimbal_priority: { confirmed: 'DRIVER', pending: '', rejected: '' },
    });

    expect(fmaState.columns()).toEqual(
      expect.arrayContaining([
        { label: 'DRIVE', confirmed: DriveMode.Velocity, commanded: null },
        { label: 'ARM', confirmed: ArmMode.Position, commanded: null },
        { label: 'LAW', confirmed: LawMode.Direct },
        { label: 'GIMBAL', confirmed: 'DRIVER', commanded: null },
      ]),
    );
    expect(fmaState.armOverrideState()).toBe(ArmOverrideState.Inactive);
    expect(fmaState.armOverridePending()).toBe(true);
    expect(fmaState.armOverrideActive()).toBe(false);

    handleFmaMessage({
      schema: 'dcr/fma-state/v1',
      sequence: 2,
      drive: { confirmed: 'VELOCITY', pending: '', rejected: '' },
      arm: { confirmed: 'POSITION', pending: '', rejected: '' },
      law: 'DIRECT',
      arm_override: { state: 'ACTIVE', pending: 'DISABLE' },
      system: 'GOOD',
      gimbal_priority: { confirmed: 'DRIVER', pending: '', rejected: '' },
    });

    expect(fmaState.columns()).toEqual(
      expect.arrayContaining([{ label: 'LAW', confirmed: LawMode.Direct }]),
    );
    expect(fmaState.armOverrideState()).toBe(ArmOverrideState.Active);
    expect(fmaState.armOverridePendingCommand()).toBe(ArmOverrideCommand.Disable);
    expect(fmaState.armOverrideActive()).toBe(true);
    expect(fmaState.armOverridePending()).toBe(false);
  });
});
