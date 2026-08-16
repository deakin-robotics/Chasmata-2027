import { Service, computed, inject, signal } from '@angular/core';

import { GamepadInput } from '../../gamepad/gamepad-input';
import { RosConnection } from '../../ros/ros-connection';
import { ControlModeService } from '../control-mode';
import { ArmCommandPublisher } from './arm-command-publisher';

const PUBLISH_INTERVAL_MS = 20;
const MINIMUM_ARM_AXES = 4;

/** Coordinates authorised gamepad input with gated Arm Joy publishing. */
@Service()
export class ArmControl {
  private readonly rosConnection = inject(RosConnection);
  private readonly controlMode = inject(ControlModeService);
  private readonly gamepad = inject(GamepadInput);
  private readonly publisher = inject(ArmCommandPublisher);

  private publishTimer: ReturnType<typeof setInterval> | null = null;
  private readonly enabledState = signal(false);
  private readonly readinessErrorState = signal<string | null>(null);

  readonly enabled = this.enabledState.asReadonly();
  readonly readinessError = this.readinessErrorState.asReadonly();
  readonly gamepadConnected = this.gamepad.connected;
  readonly gamepadName = this.gamepad.name;
  readonly canControlArm = computed(
    () => this.enabledState() && this.publisher.canPublish(),
  );

  /** Returns the reason Arm control cannot be enabled, or null when ready. */
  readiness(): string | null {
    this.gamepad.start();

    if (!this.rosConnection.isConnected()) {
      return 'Connect to ROSbridge before enabling Arm control.';
    }

    if (this.controlMode.isPilotActive()) {
      return 'Release Pilot control before enabling Arm control.';
    }

    const snapshot = this.gamepad.snapshot();
    if (!this.gamepad.connected() || !snapshot) {
      return 'Connect a gamepad before enabling Arm control.';
    }

    if (snapshot.axes.length < MINIMUM_ARM_AXES) {
      return 'The connected gamepad does not provide enough Arm axes.';
    }

    return null;
  }

  /** Enables authorised 50 Hz Arm Joy publishing. */
  enable(): boolean {
    const readinessError = this.readiness();
    this.readinessErrorState.set(readinessError);
    if (readinessError) return false;

    this.controlMode.activate('arm');
    this.enabledState.set(true);
    this.startPublishing();
    return true;
  }

  /** Stops Arm output and releases Arm control authority. */
  disable(): void {
    if (this.publishTimer !== null) {
      clearInterval(this.publishTimer);
      this.publishTimer = null;
    }

    this.publisher.releaseArmControl();
    this.enabledState.set(false);
    this.gamepad.stop();
  }

  private startPublishing(): void {
    if (this.publishTimer !== null) return;

    this.publishTimer = setInterval(() => this.publishCurrentInput(), PUBLISH_INTERVAL_MS);
  }

  private publishCurrentInput(): void {
    const snapshot = this.gamepad.snapshot();

    if (!this.rosConnection.isConnected() || !snapshot || snapshot.axes.length < MINIMUM_ARM_AXES) {
      this.disable();
      return;
    }

    this.publisher.publish(snapshot);
  }
}
