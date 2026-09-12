import { ArmMode, DriveMode } from '../fma/fma-state.service';

import { CONTROL_SCHEME_CATALOGUE } from './control-scheme-catalogue';

describe('CONTROL_SCHEME_CATALOGUE', () => {
  it('contains the current driver mapping', () => {
    expect(CONTROL_SCHEME_CATALOGUE.driver[DriveMode.Manual].controls).toEqual(
      expect.arrayContaining([
        { input: 'left-trigger', label: 'LT', action: 'Left track' },
        { input: 'right-trigger', label: 'RT', action: 'Right track' },
        { input: 'button-y', label: 'Y', action: 'Forward / reverse' },
        { input: 'right-stick', label: 'Right joystick', action: 'Gimbal' },
        { input: 'right-stick-click', label: 'Right joystick click', action: 'Gimbal Priority' },
      ]),
    );
    expect(CONTROL_SCHEME_CATALOGUE.driver[DriveMode.Velocity].controls).toEqual(
      expect.arrayContaining([
        { input: 'left-stick', label: 'Left joystick', action: 'Drive rover' },
        { input: 'right-stick', label: 'Right joystick', action: 'Gimbal' },
        { input: 'right-stick-click', label: 'Right joystick click', action: 'Gimbal Priority' },
      ]),
    );
    expect(DriveMode.Managed in CONTROL_SCHEME_CATALOGUE.driver).toBe(false);
  });

  it('contains entries for both arm control modes', () => {
    expect(CONTROL_SCHEME_CATALOGUE.arm[ArmMode.Manual].default.controls).toEqual(
      expect.arrayContaining([
        { input: 'left-stick-x', label: 'Left joystick X', action: 'Joint 4 yaw' },
        { input: 'left-stick-y', label: 'Left joystick Y', action: 'Joint 5 pitch' },
        { input: 'd-pad-y', label: 'D-pad Y', action: 'Joint 3' },
        { input: 'left-trigger', label: 'LT', action: 'Joint 6 roll' },
        { input: 'right-trigger', label: 'RT', action: 'Joint 6 roll' },
        { input: 'right-stick-x', label: 'Right joystick X', action: 'Joint 1 yaw' },
        {
          input: 'right-stick-y',
          label: 'Right joystick Y',
          action: 'Joint 2 pitch',
        },
        { input: 'button-a', label: 'A', action: 'Laser' },
        { input: 'button-x', label: 'X', action: 'Close end-effector' },
        { input: 'right-bumper', label: 'RB', action: 'Center EE / switch view' },
        { input: 'left-bumper', label: 'LB', action: 'Gimbal control (Hold)' },
      ]),
    );
    expect(
      CONTROL_SCHEME_CATALOGUE.arm[ArmMode.Manual].default.controls.some(
        (control) => control.input === 'd-pad-x',
      ),
    ).toBe(false);

    expect(CONTROL_SCHEME_CATALOGUE.arm[ArmMode.Manual].modifiers?.['left-bumper']?.controls).toEqual(
      expect.arrayContaining([
        { input: 'right-stick', label: 'Right joystick', action: 'Gimbal' },
        { input: 'left-bumper', label: 'LB', action: 'Gimbal control active' },
      ]),
    );

    expect(CONTROL_SCHEME_CATALOGUE.arm[ArmMode.Position].default.controls).toEqual(
      expect.arrayContaining([
        { input: 'left-stick-x', label: 'Left joystick X', action: 'J4 yaw (UNLOCKED)' },
        { input: 'left-stick-y', label: 'Left joystick Y', action: 'J5 pitch (UNLOCKED)' },
        { input: 'd-pad-x', label: 'D-pad X', action: 'Move J4 pivot X/Y' },
        { input: 'd-pad-y', label: 'D-pad Y', action: 'Move J4 pivot X/Y' },
        { input: 'left-trigger', label: 'LT', action: 'J6 roll (UNLOCKED)' },
        { input: 'right-trigger', label: 'RT', action: 'J6 roll (UNLOCKED)' },
        { input: 'right-stick', label: 'Right joystick', action: 'Pan model viewer' },
        { input: 'button-a', label: 'A', action: 'Laser' },
        { input: 'button-b', label: 'B', action: 'Open end-effector' },
        { input: 'button-x', label: 'X', action: 'Close end-effector' },
        { input: 'right-bumper', label: 'RB', action: 'Center EE / switch view' },
        { input: 'left-stick-click', label: 'Left joystick click', action: 'Toggle orientation lock' },
        { input: 'right-stick-click', label: 'Right joystick click', action: 'Gimbal Priority' },
      ]),
    );
    expect(CONTROL_SCHEME_CATALOGUE.arm[ArmMode.Position].modifiers?.['left-bumper']?.controls).toEqual(
      expect.arrayContaining([
        { input: 'right-stick', label: 'Right joystick', action: 'Gimbal' },
        { input: 'left-bumper', label: 'LB', action: 'Gimbal control active' },
      ]),
    );
  });
});
