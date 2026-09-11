import { Service, signal } from '@angular/core';

export type ArmViewMode = 'side' | 'top';

/** Shares the viewer's discrete plane with Position-mode input handling. */
@Service()
export class ArmViewModeService {
  private readonly viewState = signal<ArmViewMode>('side');

  readonly view = this.viewState.asReadonly();

  set(view: ArmViewMode): void {
    this.viewState.set(view);
  }

  toggle(): ArmViewMode {
    const nextView = this.viewState() === 'side' ? 'top' : 'side';
    this.viewState.set(nextView);
    return nextView;
  }

  reset(): void {
    this.viewState.set('side');
  }
}
