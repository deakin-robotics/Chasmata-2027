import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Service as RosService } from 'roslib';
import { RosConnection } from '../../ros/ros-connection';
import { RosHeartbeatMonitor } from '../../ros/ros-heartbeat-monitor';
import { ArmRecovery } from './arm-recovery';

describe('ArmRecovery', () => {
  const client = signal<any>(null);
  const available = signal(false);
  beforeEach(() => {
    client.set(null); available.set(false);
    TestBed.configureTestingModule({ providers: [
      { provide: RosConnection, useValue: { client: client.asReadonly() } },
      { provide: RosHeartbeatMonitor, useValue: { roverAvailable: available.asReadonly() } },
    ] });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('reports an unavailable rover', async () => {
    expect(await TestBed.inject(ArmRecovery).rearm()).toEqual({ success: false, message: 'Rover connection unavailable.' });
  });
  it.each([true, false])('returns the driver response for success=%s', async (success) => {
    client.set({}); available.set(true);
    vi.spyOn(RosService.prototype, 'callService').mockImplementation((_request, callback) => {
      callback?.({ success, message: 'driver response' });
    });
    expect(await TestBed.inject(ArmRecovery).rearm()).toEqual({ success, message: 'driver response' });
  });
  it('reports a service error', async () => {
    client.set({}); available.set(true);
    vi.spyOn(RosService.prototype, 'callService').mockImplementation((_request, _callback, failed) => {
      failed?.('service unavailable');
    });
    expect(await TestBed.inject(ArmRecovery).rearm()).toEqual({ success: false, message: 'Arm recovery service unavailable.' });
  });
  it('reports a service timeout', async () => {
    vi.useFakeTimers(); client.set({}); available.set(true);
    vi.spyOn(RosService.prototype, 'callService').mockImplementation(() => {});
    const result = TestBed.inject(ArmRecovery).rearm();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toEqual({ success: false, message: 'Arm recovery timed out.' });
  });
});
