import { Service, inject } from '@angular/core';
import { Service as RosService } from 'roslib';
import { RosConnection } from '../../ros/ros-connection';
import { RosHeartbeatMonitor } from '../../ros/ros-heartbeat-monitor';

export interface ArmRecoveryResult { success: boolean; message: string; }

@Service()
export class ArmRecovery {
  private readonly connection = inject(RosConnection);
  private readonly heartbeat = inject(RosHeartbeatMonitor);

  rearm(): Promise<ArmRecoveryResult> {
    const client = this.connection.client();
    if (!client || !this.heartbeat.roverAvailable()) {
      return Promise.resolve({ success: false, message: 'Rover connection unavailable.' });
    }
    return new Promise((resolve) => {
      let completed = false;
      const finish = (result: ArmRecoveryResult): void => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => finish({ success: false, message: 'Arm recovery timed out.' }), 3000);
      try {
        const service = new RosService<Record<string, never>, ArmRecoveryResult>({
          ros: client, name: '/arm/rearm', serviceType: 'std_srvs/srv/Trigger',
        });
        service.callService({}, (response) => finish(response),
          () => finish({ success: false, message: 'Arm recovery service unavailable.' }), 3);
      } catch {
        finish({ success: false, message: 'Arm recovery service unavailable.' });
      }
    });
  }
}
