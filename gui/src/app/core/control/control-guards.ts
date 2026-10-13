import { inject } from '@angular/core';
import { CanActivateFn, CanDeactivateFn } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { map } from 'rxjs';

import {
  ControlConfirmationDialog,
  ControlConfirmationDialogData,
} from '../../shared/confirmation-dialog/control-confirmation-dialog';
import { ArmControlModeService } from './arm/arm-control-mode';
import { DriverControl } from './drive/driver-control';

function openConfirmation(data: ControlConfirmationDialogData) {
  return inject(MatDialog)
    .open(ControlConfirmationDialog, {
      data,
      disableClose: true,
      width: 'min(100% - 2rem, 28rem)',
    })
    .afterClosed();
}

/** Requires explicit confirmation before opening the Driver workspace. */
export const driverControlGuard: CanActivateFn = () => {
  return openConfirmation({
    title: 'Enter Driver Station?',
    confirmLabel: 'Enter',
  }).pipe(map((confirmed) => confirmed === true));
};

/** Stops drivetrain output whenever the Driver control workspace is left. */
export const driverControlExitGuard: CanDeactivateFn<unknown> = () => {
  inject(DriverControl).disable();
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
  inject(ArmControlModeService).disable();
  return true;
};
