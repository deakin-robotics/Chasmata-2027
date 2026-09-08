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
  { input: 'left-stick-x', label: 'Left joystick X', action: 'Joint 1' },
  { input: 'left-stick-y', label: 'Left joystick Y', action: 'Joint 2' },
  { input: 'd-pad-x', label: 'D-pad X', action: 'Joint 6' },
  { input: 'd-pad-y', label: 'D-pad Y', action: 'Joint 5' },
  { input: 'button-a', label: 'A', action: 'Laser' },
  { input: 'button-b', label: 'B', action: 'Open end-effector' },
  { input: 'button-x', label: 'X', action: 'Close end-effector' },
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
          { input: 'right-stick-x', label: 'Right joystick X', action: 'Joint 4' },
          { input: 'right-stick-y', label: 'Right joystick Y', action: 'Joint 3' },
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
          {
            input: 'left-stick',
            label: 'Left joystick',
            action: 'IK horizontal position',
          },
          { input: 'd-pad-y', label: 'D-pad', action: 'IK height' },
          { input: 'right-stick', label: 'Right joystick', action: 'Gimbal' },
          { input: 'button-a', label: 'A', action: 'Laser' },
          { input: 'button-b', label: 'B', action: 'Open end-effector' },
          { input: 'button-x', label: 'X', action: 'Close end-effector' },
          { input: 'right-stick-click', label: 'Right joystick click', action: 'Gimbal Priority' },
        ],
      },
    },
  },
};
