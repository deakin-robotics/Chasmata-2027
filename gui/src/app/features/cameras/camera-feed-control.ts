import { Injectable, signal } from '@angular/core';

/** Dashboard-scoped camera playback preference shared by the switch and tiles. */
@Injectable({ providedIn: 'root' })
export class CameraFeedControl {
  private readonly enabledState = signal(false);
  readonly enabled = this.enabledState.asReadonly();

  setEnabled(enabled: boolean): void {
    this.enabledState.set(enabled);
  }
}
