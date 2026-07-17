import { Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

interface CameraStreamSettingsData {
  label: string;
  url: string;
}

@Component({
  selector: 'app-camera-stream-settings-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  templateUrl: './camera-stream-settings-dialog.html',
  styleUrl: './camera-stream-settings-dialog.scss',
})
export class CameraStreamSettingsDialog {
  readonly data = inject<CameraStreamSettingsData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<CameraStreamSettingsDialog>);
  readonly url = new FormControl(this.data.url, {
    nonNullable: true,
    validators: [Validators.pattern(/^$|^https?:\/\/\S+$/i)],
  });

  apply(): void {
    this.url.markAsTouched();
    if (this.url.invalid) return;

    this.dialogRef.close(this.url.value.trim());
  }
}
