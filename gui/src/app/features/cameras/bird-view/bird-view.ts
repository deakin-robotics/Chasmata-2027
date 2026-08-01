import { Component } from '@angular/core';

/**
 * Placeholder for a camera-derived bird's-eye rover view.
 *
 * The component will later receive its visual source from the camera or vision
 * pipeline, while remaining reusable by both Pilot and Arm operator layouts.
 */
@Component({
  selector: 'app-bird-view',
  templateUrl: './bird-view.html',
  styleUrl: './bird-view.scss',
})
export class BirdView {}
