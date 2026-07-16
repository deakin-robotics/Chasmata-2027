import { Component } from '@angular/core';

import { GamepadSchematic } from '../gamepad-schematic/gamepad-schematic';

/** Owns the Pilot workspace's gamepad-related user interface. */
@Component({
  selector: 'app-gamepad-control-panel',
  imports: [GamepadSchematic],
  templateUrl: './gamepad-control-panel.html',
  styleUrl: './gamepad-control-panel.scss',
})
export class GamepadControlPanel {}
