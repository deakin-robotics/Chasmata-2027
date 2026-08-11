import { Component, computed, signal } from '@angular/core';

import { ArmPage } from './pages/arm-page/arm-page';
import { CameraPage } from './pages/camera-page/camera-page';
import { DrivePage } from './pages/drive-page/drive-page';
import { LinkPage } from './pages/link-page/link-page';
import { PowerPage } from './pages/power-page/power-page';
import { SystemPage } from './pages/system-page/system-page';

type EcamPageName = 'DRIVE' | 'ARM' | 'POWER' | 'LINK' | 'CAMERA' | 'SYSTEM';

interface EcamPage {
  name: EcamPageName;
}

/** Lower ECAM display with placeholder system pages. */
@Component({
  selector: 'app-ecam-system-display',
  imports: [DrivePage, ArmPage, PowerPage, LinkPage, CameraPage, SystemPage],
  templateUrl: './ecam-system-display.html',
  styleUrl: './ecam-system-display.scss',
})
export class EcamSystemDisplay {
  readonly pages: readonly EcamPage[] = [
    { name: 'DRIVE' },
    { name: 'ARM' },
    { name: 'POWER' },
    { name: 'LINK' },
    { name: 'CAMERA' },
    { name: 'SYSTEM' },
  ];

  readonly selectedPage = signal<EcamPageName>('DRIVE');
  readonly selectedPageDefinition = computed(
    () => this.pages.find((page) => page.name === this.selectedPage()) ?? this.pages[0],
  );

  selectPage(page: EcamPage): void {
    this.selectedPage.set(page.name);
  }
}
