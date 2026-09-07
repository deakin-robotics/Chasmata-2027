import { Component, computed, inject, input } from '@angular/core';

import { ArmControlModeService } from '../../core/control/arm/arm-control-mode';
import { GamepadInput } from '../../core/gamepad/gamepad-input';
import { DriveMode, FmaColumn, FmaStateService } from '../../core/fma/fma-state.service';
import {
  CONTROL_SCHEME_CATALOGUE,
  ControlSchemeControl,
  ControlSchemeMapping,
  GamepadInput as CatalogueGamepadInput,
  PilotDriveControlMode,
} from '../../core/control/control-scheme-catalogue';

export type ControlSchemeContext = 'pilot' | 'arm';

const EMPTY_MAPPING: ControlSchemeMapping = { controls: [] };

const LEFT_SIDE_INPUTS = new Set<CatalogueGamepadInput>([
  'left-stick',
  'left-stick-x',
  'left-stick-y',
  'd-pad',
  'd-pad-x',
  'd-pad-y',
  'left-bumper',
  'left-trigger',
]);

/** Reusable three-part control reference with mappings around its gamepad. */
@Component({
  selector: 'app-control-scheme',
  templateUrl: './control-scheme.html',
  styleUrl: './control-scheme.scss',
})
export class ControlScheme {
  readonly context = input<ControlSchemeContext>('pilot');

  private readonly armControlMode = inject(ArmControlModeService);
  private readonly fmaState = inject(FmaStateService);
  private readonly gamepad = inject(GamepadInput);

  readonly activeMapping = computed(() => {
    if (this.context() === 'arm') {
      const modeMapping = CONTROL_SCHEME_CATALOGUE.arm[this.armControlMode.mode()];
      if (!modeMapping) return EMPTY_MAPPING;

      return this.isLeftBumperPressed()
        ? (modeMapping.modifiers?.['left-bumper'] ?? modeMapping.default)
        : modeMapping.default;
    }

    const driveMode = this.fmaState.columns().find(
      (column): column is Extract<FmaColumn, { label: 'DRIVE' }> => column.label === 'DRIVE',
    )?.confirmed;

    if (driveMode !== DriveMode.Manual && driveMode !== DriveMode.Velocity) {
      return EMPTY_MAPPING;
    }

    return CONTROL_SCHEME_CATALOGUE.pilot[driveMode as PilotDriveControlMode];
  });

  readonly leftControls = computed(() => this.controlsForSide(true));
  readonly rightControls = computed(() => this.controlsForSide(false));

  private controlsForSide(leftSide: boolean): readonly ControlSchemeControl[] {
    return this.activeMapping().controls.filter(
      (control) => this.isLeftSideInput(control.input) === leftSide,
    );
  }

  private isLeftBumperPressed(): boolean {
    return (this.gamepad.snapshot()?.buttons[4] ?? 0) > 0;
  }

  private isLeftSideInput(input: CatalogueGamepadInput): boolean {
    return LEFT_SIDE_INPUTS.has(input);
  }
}
