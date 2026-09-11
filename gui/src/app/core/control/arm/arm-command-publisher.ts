import { Service, computed, inject } from '@angular/core';
import { Ros, Topic } from 'roslib';

import { GamepadSnapshot } from '../../gamepad/gamepad-input';
import { RosConnection } from '../../ros/ros-connection';
import { ControlModeService } from '../control-mode';

export interface ArmJoyCommand {
  axes: readonly number[];
  buttons: readonly number[];
}

const ARM_JOY_TOPIC = '/arm/joy';
const JOY_MESSAGE_TYPE = 'sensor_msgs/Joy';
const ARM_AXES_COUNT = 10;
const ARM_BUTTON_COUNT = 12;
const LEFT_TRIGGER_BUTTON_INDEX = 6;
const RIGHT_TRIGGER_BUTTON_INDEX = 7;
const CLEAR_FAULTS_BUTTON_INDEX = 10;
const STOP_COMMAND: ArmJoyCommand = {
  axes: new Array(ARM_AXES_COUNT).fill(0),
  buttons: new Array(ARM_BUTTON_COUNT).fill(0),
};
const CLEAR_FAULTS_COMMAND: ArmJoyCommand = {
  axes: [...STOP_COMMAND.axes],
  buttons: STOP_COMMAND.buttons.map((_, index) => (index === CLEAR_FAULTS_BUTTON_INDEX ? 1 : 0)),
};

/** Publishes Arm Joy commands using the old base-station mapping. */
@Service()
export class ArmCommandPublisher {
  private readonly rosConnection = inject(RosConnection);
  private readonly controlMode = inject(ControlModeService);

  private joyTopic: Topic | null = null;
  private topicClient: Ros | null = null;

  readonly canPublish = computed(
    () => this.rosConnection.isConnected() && this.controlMode.isArmActive(),
  );

  /** Publishes one remapped Arm Joy command when Arm control is active. */
  publish(snapshot: GamepadSnapshot): boolean {
    if (!this.canPublish()) return false;

    return this.publishCommand(this.toArmJoyCommand(snapshot));
  }

  /** Publishes Position-mode wrist input while leaving J1-J3 neutral. */
  publishPositionWrist(snapshot: GamepadSnapshot): boolean {
    if (!this.canPublish()) return false;

    const command = this.toPositionJoyCommand(snapshot);
    return this.publishCommand({
      axes: [0, 0, 0, 0, 0, 0, command.axes[0], command.axes[1], command.axes[8], command.axes[9]],
      buttons: command.buttons,
    });
  }

  /** Publishes Position-mode buttons without directly commanding J4-J6. */
  publishPositionButtons(snapshot: GamepadSnapshot): boolean {
    if (!this.canPublish()) return false;

    const command = this.toPositionJoyCommand(snapshot);
    return this.publishCommand({
      axes: new Array(ARM_AXES_COUNT).fill(0),
      buttons: command.buttons,
    });
  }

  /** Sends a zeroed Arm Joy command. */
  publishStop(): boolean {
    return this.publishCommand(STOP_COMMAND);
  }

  /** Publishes the old Home/PS button-10 clear-fault command once. */
  publishClearFaults(): boolean {
    return this.publishCommand(CLEAR_FAULTS_COMMAND);
  }

  /** Stops Arm output before releasing Arm control authority. */
  releaseArmControl(): void {
    if (!this.controlMode.isArmActive()) return;

    this.publishStop();
    this.controlMode.release();
  }

  private publishCommand(command: ArmJoyCommand): boolean {
    if (!this.isValidCommand(command)) return false;

    const topic = this.getJoyTopic();
    if (!topic) return false;

    topic.publish(this.toJoyMessage(command));
    return true;
  }

  private getJoyTopic(): Topic | null {
    const client = this.rosConnection.client();
    if (!client || !this.rosConnection.isConnected()) return null;

    if (this.joyTopic && this.topicClient === client) return this.joyTopic;

    this.topicClient = client;
    this.joyTopic = new Topic({
      ros: client,
      name: ARM_JOY_TOPIC,
      messageType: JOY_MESSAGE_TYPE,
    });

    return this.joyTopic;
  }

  private toArmJoyCommand(snapshot: GamepadSnapshot): ArmJoyCommand {
    const rawAxes = snapshot.axes;
    const rawButtons = snapshot.buttons;
    const dpadX = (rawButtons[15] ?? 0) - (rawButtons[14] ?? 0);
    const dpadY = (rawButtons[12] ?? 0) - (rawButtons[13] ?? 0);

    return {
      axes: [
        -(rawAxes[0] ?? 0),
        -(rawAxes[1] ?? 0),
        0,
        -(rawAxes[2] ?? 0),
        -(rawAxes[3] ?? 0),
        0,
        dpadX,
        dpadY,
        rawButtons[RIGHT_TRIGGER_BUTTON_INDEX] ?? 0,
        rawButtons[LEFT_TRIGGER_BUTTON_INDEX] ?? 0,
      ],
      buttons: [
        rawButtons[0] ?? 0,
        rawButtons[1] ?? 0,
        rawButtons[3] ?? 0,
        rawButtons[2] ?? 0,
        rawButtons[4] ?? 0,
        rawButtons[5] ?? 0,
        0,
        0,
        rawButtons[8] ?? 0,
        rawButtons[9] ?? 0,
        rawButtons[16] ?? rawButtons[10] ?? 0,
        rawButtons[11] ?? 0,
      ],
    };
  }

  private toPositionJoyCommand(snapshot: GamepadSnapshot): ArmJoyCommand {
    const command = this.toArmJoyCommand(snapshot);

    // On gamepads without an extended button slot, button 10 is the L3
    // fallback. Position mode consumes L3 as the orientation-lock toggle.
    if (snapshot.buttons[16] === undefined) {
      const buttons = [...command.buttons];
      buttons[CLEAR_FAULTS_BUTTON_INDEX] = 0;
      return { ...command, buttons };
    }

    return command;
  }

  private isValidCommand(command: ArmJoyCommand): boolean {
    return (
      command.axes.length >= ARM_AXES_COUNT &&
      command.buttons.length >= ARM_BUTTON_COUNT &&
      command.axes.every(Number.isFinite) &&
      command.buttons.every(Number.isFinite)
    );
  }

  private toJoyMessage(command: ArmJoyCommand): Record<string, unknown> {
    return {
      header: {
        stamp: { sec: 0, nanosec: 0 },
        frame_id: '',
      },
      axes: [...command.axes],
      buttons: [...command.buttons],
    };
  }
}
