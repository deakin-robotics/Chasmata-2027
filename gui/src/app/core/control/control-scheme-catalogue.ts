import { ArmControlMode } from './arm/arm-control-mode';
import { ArmMode, DriveMode } from '../fma/fma-state.service';

export type DriverControlMode = DriveMode.Manual | DriveMode.Velocity;

/** Physical input that can be shown in a gamepad control reference. */
export type GamepadInput =
  | 'left-stick'
  | 'left-stick-x'
  | 'left-stick-y'
  | 'right-stick'
  | 'right-stick-x'
  | 'right-stick-y'
  | 'd-pad'
  | 'd-pad-x'
  | 'd-pad-y'
  | 'button-a'
  | 'button-b'
  | 'button-x'
  | 'button-y'
  | 'left-bumper'
  | 'right-bumper'
  | 'left-trigger'
  | 'right-trigger'
  | 'left-stick-click'
  | 'right-stick-click'
  | 'share'
  | 'options'
  | 'home';

/** One physical gamepad input and the operation it performs in a mode. */
export interface ControlSchemeControl {
  readonly input: GamepadInput;
  readonly label: string;
  readonly action: string | null;
}

/** Complete input mapping for one dashboard mode. */
export interface ControlSchemeMapping {
  readonly controls: readonly ControlSchemeControl[];
}

/** A mode mapping with an optional modifier-specific mapping. */
export interface ControlSchemeMode {
  readonly default: ControlSchemeMapping;
  readonly modifiers?: Readonly<Partial<Record<GamepadInput, ControlSchemeMapping>>>;
}

const ARM_MANUAL_SHARED_CONTROLS: readonly ControlSchemeControl[] = [
  { input: 'left-stick-x', label: 'Left joystick X', action: 'Joint 4 yaw' },
  { input: 'left-stick-y', label: 'Left joystick Y', action: 'Joint 5 pitch' },
  { input: 'd-pad-y', label: 'D-pad Y', action: 'Joint 3' },
  { input: 'left-trigger', label: 'LT', action: 'Joint 6 roll' },
  { input: 'right-trigger', label: 'RT', action: 'Joint 6 roll' },
  { input: 'button-a', label: 'A', action: 'Laser' },
  { input: 'button-b', label: 'B', action: 'Open end-effector' },
  { input: 'button-x', label: 'X', action: 'Close end-effector' },
  { input: 'right-bumper', label: 'RB', action: 'Center EE / switch view' },
  { input: 'right-stick-click', label: 'Right joystick click', action: 'Gimbal Priority' },
];

/**
 * Central catalogue for the labels and actions shown around the gamepad.
 *
 * Managed modes are intentionally excluded: they represent autonomous
 * ownership and therefore have no operator gamepad mapping.
 */
export const CONTROL_SCHEME_CATALOGUE: {
  readonly driver: Readonly<Record<DriverControlMode, ControlSchemeMapping>>;
  readonly arm: Readonly<Record<ArmControlMode, ControlSchemeMode>>;
} = {
  driver: {
    [DriveMode.Manual]: {
      controls: [
        { input: 'left-trigger', label: 'LT', action: 'Left track' },
        { input: 'right-trigger', label: 'RT', action: 'Right track' },
        { input: 'button-y', label: 'Y', action: 'Forward / reverse' },
        { input: 'right-stick', label: 'Right joystick', action: 'Gimbal' },
        { input: 'right-stick-click', label: 'Right joystick click', action: 'Gimbal Priority' },
      ],
    },
    [DriveMode.Velocity]: {
      controls: [
        { input: 'left-stick', label: 'Left joystick', action: 'Drive rover' },
        { input: 'right-stick', label: 'Right joystick', action: 'Gimbal' },
        { input: 'right-stick-click', label: 'Right joystick click', action: 'Gimbal Priority' },
      ],
    },
  },
  arm: {
    [ArmMode.Manual]: {
      default: {
        controls: [
          ...ARM_MANUAL_SHARED_CONTROLS,
          { input: 'right-stick-x', label: 'Right joystick X', action: 'Joint 1 yaw' },
          { input: 'right-stick-y', label: 'Right joystick Y', action: 'Joint 2 pitch' },
          { input: 'left-bumper', label: 'LB', action: 'Gimbal control (Hold)' },
        ],
      },
      modifiers: {
        'left-bumper': {
          controls: [
            ...ARM_MANUAL_SHARED_CONTROLS,
            { input: 'right-stick', label: 'Right joystick', action: 'Gimbal' },
            { input: 'left-bumper', label: 'LB', action: 'Gimbal control active' },
          ],
        },
      },
    },
    [ArmMode.Position]: {
      default: {
        controls: [
          { input: 'left-trigger', label: 'LT', action: 'J6 roll (UNLOCKED)' },
          {
            input: 'left-stick-x',
            label: 'Left joystick X',
            action: 'J4 yaw (UNLOCKED)',
          },
          {
            input: 'left-stick-y',
            label: 'Left joystick Y',
            action: 'J5 pitch (UNLOCKED)',
          },
          { input: 'd-pad-x', label: 'D-pad X', action: 'Move J4 pivot X/Y' },
          { input: 'd-pad-y', label: 'D-pad Y', action: 'Move J4 pivot X/Y' },
          { input: 'right-trigger', label: 'RT', action: 'J6 roll (UNLOCKED)' },
          { input: 'right-stick', label: 'Right joystick', action: 'Pan model viewer' },
          { input: 'left-bumper', label: 'LB', action: 'Gimbal control (Hold)' },
          { input: 'button-a', label: 'A', action: 'Laser' },
          { input: 'button-b', label: 'B', action: 'Open end-effector' },
          { input: 'button-x', label: 'X', action: 'Close end-effector' },
          { input: 'right-bumper', label: 'RB', action: 'Center EE / switch view' },
          { input: 'left-stick-click', label: 'Left joystick click', action: 'Toggle orientation lock' },
          { input: 'right-stick-click', label: 'Right joystick click', action: 'Gimbal Priority' },
        ],
      },
      modifiers: {
        'left-bumper': {
          controls: [
            { input: 'left-trigger', label: 'LT', action: 'J6 roll (UNLOCKED)' },
            {
              input: 'left-stick-x',
              label: 'Left joystick X',
              action: 'J4 yaw (UNLOCKED)',
            },
            {
              input: 'left-stick-y',
              label: 'Left joystick Y',
              action: 'J5 pitch (UNLOCKED)',
            },
            { input: 'd-pad-x', label: 'D-pad X', action: 'Move J4 pivot X/Y' },
            { input: 'd-pad-y', label: 'D-pad Y', action: 'Move J4 pivot X/Y' },
            { input: 'right-trigger', label: 'RT', action: 'J6 roll (UNLOCKED)' },
            { input: 'right-stick', label: 'Right joystick', action: 'Gimbal' },
            { input: 'left-bumper', label: 'LB', action: 'Gimbal control active' },
            { input: 'button-a', label: 'A', action: 'Laser' },
            { input: 'button-b', label: 'B', action: 'Open end-effector' },
            { input: 'button-x', label: 'X', action: 'Close end-effector' },
            { input: 'right-bumper', label: 'RB', action: 'Center EE / switch view' },
            { input: 'left-stick-click', label: 'Left joystick click', action: 'Toggle orientation lock' },
            { input: 'right-stick-click', label: 'Right joystick click', action: 'Gimbal Priority' },
          ],
        },
      },
    },
  },
};
