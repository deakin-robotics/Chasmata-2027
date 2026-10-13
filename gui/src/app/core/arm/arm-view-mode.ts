import { Service, signal } from '@angular/core';

export type ArmViewMode = 'side' | 'top' | 'free';
type CanonicalArmViewMode = Exclude<ArmViewMode, 'free'>;

/** Shares the viewer's discrete plane with Position-mode input handling. */
@Service()
export class ArmViewModeService {
  private readonly viewState = signal<ArmViewMode>('side');
  private canonicalView: CanonicalArmViewMode = 'side';

  readonly view = this.viewState.asReadonly();

  set(view: ArmViewMode): void {
    if (view !== 'free') this.canonicalView = view;
    this.viewState.set(view);
  }

  setFree(): void {
    this.viewState.set('free');
  }

  toggle(): ArmViewMode {
    const nextView = this.canonicalView === 'side' ? 'top' : 'side';
    this.canonicalView = nextView;
    this.viewState.set(nextView);
    return nextView;
  }

  reset(): void {
    this.canonicalView = 'side';
    this.viewState.set('side');
  }
}
