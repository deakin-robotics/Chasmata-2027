import { Component, computed, inject, input } from '@angular/core';

import { GamepadInput } from '../../core/gamepad/gamepad-input';
import { ArmMode, DriveMode, FmaColumn, FmaStateService } from '../../core/fma/fma-state.service';
import {
  CONTROL_SCHEME_CATALOGUE,
  ControlSchemeControl,
  ControlSchemeMapping,
  GamepadInput as CatalogueGamepadInput,
} from '../../core/control/control-scheme-catalogue';
import { RosConnection } from '../../core/ros/ros-connection';
import { UnavailableOverlay } from '../unavailable-overlay/unavailable-overlay';

export type ControlSchemeContext = 'driver' | 'arm';

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
  'left-stick-click',
]);

/** Reusable three-part control reference with mappings around its gamepad. */
@Component({
  selector: 'app-control-scheme',
  imports: [UnavailableOverlay],
  templateUrl: './control-scheme.html',
  styleUrl: './control-scheme.scss',
})
export class ControlScheme {
  readonly context = input<ControlSchemeContext>('driver');

  private readonly gamepad = inject(GamepadInput);
  private readonly fmaState = inject(FmaStateService);
  private readonly rosConnection = inject(RosConnection);

  readonly activeMapping = computed(() => {
    if (this.context() === 'arm') {
      const armMode = this.confirmedArmMode();
      if (armMode !== ArmMode.Manual && armMode !== ArmMode.Position) {
        return EMPTY_MAPPING;
      }

      const modeMapping = CONTROL_SCHEME_CATALOGUE.arm[armMode];

      return this.isLeftBumperPressed()
        ? (modeMapping.modifiers?.['left-bumper'] ?? modeMapping.default)
        : modeMapping.default;
    }

    const driveMode = this.confirmedDriveMode();
    if (driveMode !== DriveMode.Manual && driveMode !== DriveMode.Velocity) {
      return EMPTY_MAPPING;
    }

    return CONTROL_SCHEME_CATALOGUE.driver[driveMode];
  });

  readonly leftControls = computed(() => this.controlsForSide(true));
  readonly rightControls = computed(() => this.controlsForSide(false));
  readonly rosConnected = this.rosConnection.isConnected;

  private controlsForSide(leftSide: boolean): readonly ControlSchemeControl[] {
    return this.activeMapping().controls.filter(
      (control) => this.isLeftSideInput(control.input) === leftSide,
    );
  }

  private isLeftBumperPressed(): boolean {
    return (this.gamepad.snapshot()?.buttons[4] ?? 0) > 0;
  }

  private confirmedDriveMode(): DriveMode | undefined {
    const driveColumn = this.fmaState
      .columns()
      .find((column): column is Extract<FmaColumn, { label: 'DRIVE' }> => column.label === 'DRIVE');

    return driveColumn?.confirmed ?? undefined;
  }

  private confirmedArmMode(): ArmMode | undefined {
    const armColumn = this.fmaState
      .columns()
      .find((column): column is Extract<FmaColumn, { label: 'ARM' }> => column.label === 'ARM');

    return armColumn?.confirmed ?? undefined;
  }

  private isLeftSideInput(input: CatalogueGamepadInput): boolean {
    return LEFT_SIDE_INPUTS.has(input);
  }
}
