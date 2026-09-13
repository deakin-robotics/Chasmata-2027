import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ArmTelemetryService } from '../arm/telemetry/arm-telemetry.service';
import { ArmOverrideCommand, ArmOverrideState } from '../control/arm/arm-override';
import { FmaStateService, LawMode } from '../fma/fma-state.service';
import { RosConnection } from './ros-connection';
import { RosTelemetryBridge } from './ros-telemetry-bridge';

vi.mock('roslib', () => ({
  Topic: class {
    subscribe(): void {}
    unsubscribe(): void {}
  },
}));

describe('RosTelemetryBridge', () => {
  it('keeps LAW and Arm Override telemetry independent', () => {
    const connected = signal(false);
    const client = signal(null);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: RosConnection,
          useValue: {
            isConnected: connected.asReadonly(),
            client: client.asReadonly(),
          },
        },
        ArmTelemetryService,
      ],
    });

    const bridge = TestBed.inject(RosTelemetryBridge);
    const fmaState = TestBed.inject(FmaStateService);
    const handleFmaMessage = (
      bridge as unknown as { handleFmaMessage(message: { data: string }): void }
    ).handleFmaMessage.bind(bridge);

    handleFmaMessage({
      data: JSON.stringify({
        law: 'DIRECT',
        arm_override: { state: 'INACTIVE', pending: 'ENABLE' },
      }),
    });

    expect(fmaState.columns()).toEqual(
      expect.arrayContaining([{ label: 'LAW', confirmed: LawMode.Direct }]),
    );
    expect(fmaState.armOverrideState()).toBe(ArmOverrideState.Inactive);
    expect(fmaState.armOverridePending()).toBe(true);
    expect(fmaState.armOverrideActive()).toBe(false);

    handleFmaMessage({
      data: JSON.stringify({
        law: 'DIRECT',
        arm_override: { state: 'ACTIVE', pending: 'DISABLE' },
      }),
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
