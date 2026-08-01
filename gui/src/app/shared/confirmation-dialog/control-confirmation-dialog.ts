import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';

export interface ControlConfirmationDialogData {
  title: string;
  confirmLabel: string;
}

/** Confirms a safety-sensitive operator action before it is applied. */
@Component({
  selector: 'app-control-confirmation-dialog',
  imports: [MatButtonModule, MatDialogModule],
  templateUrl: './control-confirmation-dialog.html',
  styleUrl: './control-confirmation-dialog.scss',
})
export class ControlConfirmationDialog {
  readonly data = inject<ControlConfirmationDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<ControlConfirmationDialog>);

  confirm(): void {
    this.dialogRef.close(true);
  }
}
