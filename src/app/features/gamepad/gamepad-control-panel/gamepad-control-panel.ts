import { Component, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';

import { PilotDriveControl } from '../../../core/control/pilot/pilot-drive-control';
import {
  ControlConfirmationDialog,
  ControlConfirmationDialogData,
} from '../../../shared/confirmation-dialog/control-confirmation-dialog';
import { GamepadSchematic } from '../gamepad-schematic/gamepad-schematic';

/** Owns the Pilot workspace's gamepad-related user interface. */
@Component({
  selector: 'app-gamepad-control-panel',
  imports: [GamepadSchematic],
  templateUrl: './gamepad-control-panel.html',
  styleUrl: './gamepad-control-panel.scss',
})
export class GamepadControlPanel {
  private readonly pilotDriveControl = inject(PilotDriveControl);
  private readonly dialog = inject(MatDialog);

  readonly masterDriveEnabled = this.pilotDriveControl.enabled;
  readonly readinessError = this.pilotDriveControl.readinessError;

  /** Requests enabled drivetrain publishing or immediately stops active publishing. */
  toggleMasterDriveControl(): void {
    if (this.masterDriveEnabled()) {
      this.pilotDriveControl.disable();
      return;
    }

    const data: ControlConfirmationDialogData = {
      title: 'Enable Master Drive Control?',
      confirmLabel: 'Enable control',
    };

    this.dialog
      .open(ControlConfirmationDialog, {
        data,
        disableClose: true,
        width: 'min(100% - 2rem, 28rem)',
      })
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed === true) this.pilotDriveControl.enable();
      });
  }
}
