import { Service, computed, inject, signal } from '@angular/core';

import { GamepadInput } from '../../gamepad/gamepad-input';
import { RosConnection } from '../../ros/ros-connection';
import { ControlModeService } from '../control-mode';
import { DriveCommandPublisher } from './drive-command-publisher';

const PUBLISH_INTERVAL_MS = 20;
const MINIMUM_DRIVE_AXES = 4;

/** Coordinates authorised gamepad input with gated drivetrain publishing. */
@Service()
export class DriverControl {
  private readonly rosConnection = inject(RosConnection);
  private readonly controlMode = inject(ControlModeService);
  private readonly gamepad = inject(GamepadInput);
  private readonly publisher = inject(DriveCommandPublisher);

  private publishTimer: ReturnType<typeof setInterval> | null = null;
  private readonly enabledState = signal(false);
  private readonly readinessErrorState = signal<string | null>(null);

  readonly enabled = this.enabledState.asReadonly();
  readonly readinessError = this.readinessErrorState.asReadonly();
  readonly gamepadConnected = this.gamepad.connected;
  readonly gamepadName = this.gamepad.name;
  readonly canDrive = computed(
    () => this.enabledState() && this.publisher.canPublish(),
  );

  /** Returns the reason Driver control cannot be enabled, or null when ready. */
  readiness(): string | null {
    this.gamepad.start();

    if (!this.rosConnection.isConnected()) {
      return 'Connect to ROSbridge before enabling Driver control.';
    }

    if (this.controlMode.isArmActive()) {
      return 'Release Arm control before enabling Driver control.';
    }

    const snapshot = this.gamepad.snapshot();
    if (!this.gamepad.connected() || !snapshot) {
      return 'Connect a gamepad before enabling Driver control.';
    }

    if (snapshot.axes.length < MINIMUM_DRIVE_AXES) {
      return 'The connected gamepad does not provide enough drive axes.';
    }

    return null;
  }

  /** Enables authorised 50 Hz drivetrain publishing. */
  enable(): boolean {
    const readinessError = this.readiness();
    this.readinessErrorState.set(readinessError);
    if (readinessError) return false;

    this.controlMode.activate('driver');
    this.enabledState.set(true);
    this.startPublishing();
    return true;
  }

  /** Stops drivetrain output and releases Driver control authority. */
  disable(): void {
    if (this.publishTimer !== null) {
      clearInterval(this.publishTimer);
      this.publishTimer = null;
    }

    this.publisher.releaseDriverControl();
    this.enabledState.set(false);
    this.gamepad.stop();
  }

  private startPublishing(): void {
    if (this.publishTimer !== null) return;

    this.publishTimer = setInterval(() => this.publishCurrentInput(), PUBLISH_INTERVAL_MS);
  }

  private publishCurrentInput(): void {
    const snapshot = this.gamepad.snapshot();

    if (!this.rosConnection.isConnected() || !snapshot || snapshot.axes.length < MINIMUM_DRIVE_AXES) {
      this.disable();
      return;
    }

    this.publisher.publish(snapshot);
  }
}
