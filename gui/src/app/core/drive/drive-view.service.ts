import { Service, signal } from '@angular/core';

@Service()
export class DriveViewService {
  readonly active = signal(false);
}
