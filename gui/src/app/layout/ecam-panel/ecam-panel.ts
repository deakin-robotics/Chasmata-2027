import { Component } from '@angular/core';

import { EcamAlertDisplay } from './ecam-alert-display/ecam-alert-display';
import { EcamSystemDisplay } from './ecam-system-display/ecam-system-display';

/** Displays consolidated rover system messages for all operators. */
@Component({
  selector: 'app-ecam-panel',
  imports: [EcamAlertDisplay, EcamSystemDisplay],
  templateUrl: './ecam-panel.html',
  styleUrl: './ecam-panel.scss',
})
export class EcamPanel {}
