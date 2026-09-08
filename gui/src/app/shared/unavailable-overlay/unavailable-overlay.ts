import { Component, input } from '@angular/core';

@Component({
  selector: 'app-unavailable-overlay',
  templateUrl: './unavailable-overlay.html',
  styleUrl: './unavailable-overlay.scss',
})
export class UnavailableOverlay {
  readonly label = input.required<string>();
}
