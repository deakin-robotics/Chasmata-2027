import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MissionControlHeader } from './mission-control-header/mission-control-header';

@Component({
  selector: 'app-mission-control',
  imports: [RouterOutlet, MissionControlHeader],
  templateUrl: './mission-control.html',
  styleUrl: './mission-control.scss',
})
export class MissionControl {}
