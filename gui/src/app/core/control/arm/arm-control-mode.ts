import { Service, computed, effect, inject, signal } from '@angular/core';

import { ArmIkCoordinator } from '../../arm/arm-ik-coordinator';
import { GamepadInput, GamepadSnapshot } from '../../gamepad/gamepad-input';
import { ArmMode } from '../../fma/fma-state.service';
import { RosConnection } from '../../ros/ros-connection';
import { ControlModeService } from '../control-mode';
import { ArmCommandPublisher } from './arm-command-publisher';
import { ArmManualControl } from './arm-manual-control';
import { ArmPositionControl } from './arm-position-control';

const PUBLISH_INTERVAL_MS = 20;
const MINIMUM_ARM_AXES = 4;

export type ArmControlMode = ArmMode.Manual | ArmMode.Position;

type ArmControlHandler = ArmManualControl | ArmPositionControl;

/** Owns Arm mode selection, the shared control session, and input routing. */
@Service()
export class ArmControlModeService {
  private readonly rosConnection = inject(RosConnection);
  private readonly controlMode = inject(ControlModeService);
  private readonly gamepad = inject(GamepadInput);
  private readonly armIkCoordinator = inject(ArmIkCoordinator);
  private readonly armCommandPublisher = inject(ArmCommandPublisher);
  private readonly armManualControl = inject(ArmManualControl);
  private readonly armPositionControl = inject(ArmPositionControl);

  private readonly modeState = signal<ArmControlMode>(ArmMode.Position);
  private readonly enabledState = signal(false);
  private readonly readinessErrorState = signal<string | null>(null);
  private publishTimer: ReturnType<typeof setInterval> | null = null;

  readonly mode = this.modeState.asReadonly();
  readonly isManual = computed(() => this.modeState() === ArmMode.Manual);
  readonly isPosition = computed(() => this.modeState() === ArmMode.Position);
  readonly selectedControl = computed<ArmControlHandler>(() =>
    this.isManual() ? this.armManualControl : this.armPositionControl,
  );
  readonly enabled = this.enabledState.asReadonly();
  readonly readinessError = this.readinessErrorState.asReadonly();
  readonly gamepadConnected = this.gamepad.connected;
  readonly gamepadName = this.gamepad.name;
  readonly canControlArm = computed(
    () => this.enabledState() && this.rosConnection.isConnected() && this.controlMode.isArmActive(),
  );

  private readonly jointTargetEffect = effect(() => {
    const enabled = this.enabledState();
    const mode = this.modeState();
    const ikStatus = this.armIkCoordinator.status();
    const jointAngles = this.armIkCoordinator.jointAngles();

    if (!enabled || mode !== ArmMode.Position || ikStatus !== 'valid' || !jointAngles) return;

    this.armCommandPublisher.publishJointTarget(jointAngles);
  });

  /** Returns the reason Arm control cannot be enabled, or null when ready. */
  readiness(): string | null {
    this.gamepad.start();

    if (!this.rosConnection.isConnected()) {
      return 'Connect to ROSbridge before enabling Arm control.';
    }

    if (this.controlMode.isDriverActive()) {
      return 'Release Driver control before enabling Arm control.';
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

  /** Enables the shared Arm input session. */
  enable(): boolean {
    const readinessError = this.readiness();
    this.readinessErrorState.set(readinessError);
    if (readinessError) return false;

    this.controlMode.activate('arm');
    this.enabledState.set(true);
    this.startRouting();
    return true;
  }

  /** Stops the shared Arm input session and releases Arm authority. */
  disable(): void {
    if (this.publishTimer !== null) {
      clearInterval(this.publishTimer);
      this.publishTimer = null;
    }

    if (this.isManual()) this.armManualControl.release();
    if (this.controlMode.isArmActive()) this.controlMode.release();
    this.enabledState.set(false);
    this.gamepad.stop();
  }

  /** Selects the Arm mode; an active session routes the next input to it. */
  setMode(mode: ArmControlMode): void {
    if (mode === this.modeState()) return;

    if (this.enabledState() && this.isManual()) this.armManualControl.stop();
    this.modeState.set(mode);
  }

  /** Routes one validated gamepad snapshot to the currently selected handler. */
  route(snapshot: GamepadSnapshot): void {
    this.selectedControl().handle(snapshot);
  }

  private startRouting(): void {
    if (this.publishTimer !== null) return;

    this.publishTimer = setInterval(() => this.routeCurrentInput(), PUBLISH_INTERVAL_MS);
  }

  private routeCurrentInput(): void {
    const snapshot = this.gamepad.snapshot();

    if (
      !this.rosConnection.isConnected() ||
      !this.controlMode.isArmActive() ||
      !snapshot ||
      snapshot.axes.length < MINIMUM_ARM_AXES
    ) {
      this.disable();
      return;
    }

    this.route(snapshot);
  }
}
