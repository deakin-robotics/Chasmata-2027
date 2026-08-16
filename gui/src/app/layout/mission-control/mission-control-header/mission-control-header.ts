import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { MissionControlFma } from '../mission-control-fma/mission-control-fma';

@Component({
  selector: 'app-mission-control-header',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MissionControlFma,
  ],
  templateUrl: './mission-control-header.html',
  styleUrl: './mission-control-header.scss',
})
export class MissionControlHeader {}
