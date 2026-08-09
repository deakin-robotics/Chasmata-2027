import { inject } from '@angular/core';
import { CanActivateFn, CanDeactivateFn } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { map } from 'rxjs';

import {
  ControlConfirmationDialog,
  ControlConfirmationDialogData,
} from '../../shared/confirmation-dialog/control-confirmation-dialog';
import { ArmControl } from './arm/arm-control';
import { PilotDriveControl } from './pilot/pilot-drive-control';

function openConfirmation(data: ControlConfirmationDialogData) {
  return inject(MatDialog)
    .open(ControlConfirmationDialog, {
      data,
      disableClose: true,
      width: 'min(100% - 2rem, 28rem)',
    })
    .afterClosed();
}

/** Requires explicit confirmation before opening the Pilot workspace. */
export const pilotControlGuard: CanActivateFn = () => {
  return openConfirmation({
    title: 'Enter Pilot Station?',
    confirmLabel: 'Enter',
  }).pipe(map((confirmed) => confirmed === true));
};

/** Stops drivetrain output whenever the Pilot control workspace is left. */
export const pilotControlExitGuard: CanDeactivateFn<unknown> = () => {
  inject(PilotDriveControl).disable();
  return true;
};

/** Requires explicit confirmation before opening the Arm workspace. */
export const armControlGuard: CanActivateFn = () => {
  return openConfirmation({
    title: 'Enter Arm Station?',
    confirmLabel: 'Enter',
  }).pipe(map((confirmed) => confirmed === true));
};

/** Stops Arm output whenever the Arm control workspace is left. */
export const armControlExitGuard: CanDeactivateFn<unknown> = () => {
  inject(ArmControl).disable();
  return true;
};
