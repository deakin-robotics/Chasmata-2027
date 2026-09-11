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
        { input: 'left-stick-x', label: 'Left joystick X', action: 'Joint 1' },
        {
          input: 'right-stick-y',
          label: 'Right joystick Y',
          action: 'Joint 3',
        },
        { input: 'd-pad-x', label: 'D-pad X', action: 'Joint 6' },
        { input: 'button-a', label: 'A', action: 'Laser' },
        { input: 'button-x', label: 'X', action: 'Close end-effector' },
        { input: 'right-bumper', label: 'RB', action: 'Center EE / switch view' },
        { input: 'left-bumper', label: 'LB', action: 'Gimbal control (Hold)' },
      ]),
    );

    expect(CONTROL_SCHEME_CATALOGUE.arm[ArmMode.Manual].modifiers?.['left-bumper']?.controls).toEqual(
      expect.arrayContaining([
        { input: 'right-stick', label: 'Right joystick', action: 'Gimbal' },
        { input: 'left-bumper', label: 'LB', action: 'Gimbal control active' },
      ]),
    );

    expect(CONTROL_SCHEME_CATALOGUE.arm[ArmMode.Position].default.controls).toEqual(
      expect.arrayContaining([
        { input: 'left-stick', label: 'Left joystick', action: 'J4 pivot position' },
        { input: 'd-pad-x', label: 'D-pad X', action: 'J4 yaw' },
        { input: 'd-pad-y', label: 'D-pad Y', action: 'J5 pitch' },
        { input: 'left-trigger', label: 'LT', action: 'J6 roll' },
        { input: 'right-trigger', label: 'RT', action: 'J6 roll' },
        { input: 'button-a', label: 'A', action: 'Laser' },
        { input: 'button-b', label: 'B', action: 'Open end-effector' },
        { input: 'button-x', label: 'X', action: 'Close end-effector' },
        { input: 'right-bumper', label: 'RB', action: 'Center EE / switch view' },
        { input: 'right-stick-click', label: 'Right joystick click', action: 'Gimbal Priority' },
      ]),
    );
  });
});
