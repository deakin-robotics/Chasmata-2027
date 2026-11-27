import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Ros, Topic } from 'roslib';
import { DrivePage } from './drive-page';
import { DriveViewService } from '../../../../../core/drive/drive-view.service';
import { RosConnection } from '../../../../../core/ros/ros-connection';
import { RosHeartbeatMonitor } from '../../../../../core/ros/ros-heartbeat-monitor';

describe('DrivePage demand', () => {
  afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); vi.useRealTimers(); });
  it('refreshes a lease, releases it on close and restores it on reconnect', () => {
    vi.useFakeTimers();
    const client = signal<Ros | null>({} as Ros);
    const available = signal(true);
    const publish = vi.spyOn(Topic.prototype, 'publish').mockImplementation(() => {});
    vi.spyOn(Topic.prototype, 'unadvertise').mockImplementation(() => {});
    TestBed.configureTestingModule({ imports: [DrivePage], providers: [
      { provide: RosConnection, useValue: { client: client.asReadonly() } },
      { provide: RosHeartbeatMonitor, useValue: { roverAvailable: available.asReadonly() } },
    ] });
    const fixture = TestBed.createComponent(DrivePage);
    fixture.detectChanges(); TestBed.flushEffects();
    expect(TestBed.inject(DriveViewService).active()).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    const first = publish.mock.calls[0][0] as { client_id: string; active: boolean };
    expect(first.active).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(publish).toHaveBeenCalledTimes(2);
    available.set(false); TestBed.flushEffects();
    expect(publish.mock.calls.at(-1)?.[0]).toEqual({ client_id: first.client_id, active: false });
    available.set(true); TestBed.flushEffects();
    expect(publish.mock.calls.at(-1)?.[0]).toEqual({ client_id: first.client_id, active: true });
    fixture.destroy();
    expect(TestBed.inject(DriveViewService).active()).toBe(false);
    expect(publish.mock.calls.at(-1)?.[0]).toEqual({ client_id: first.client_id, active: false });
  });
});
