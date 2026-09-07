import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { TwoStepActionButton } from './two-step-action-button';

describe('TwoStepActionButton', () => {
  let component: TwoStepActionButton;
  let fixture: ComponentFixture<TwoStepActionButton>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TwoStepActionButton],
    }).compileComponents();

    fixture = TestBed.createComponent(TwoStepActionButton);
    fixture.componentRef.setInput('label', 'Law Override');
    fixture.componentRef.setInput('actionLabel', 'Override');
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create in a locked state', () => {
    expect(component).toBeTruthy();
    expect(component.state()).toBe('locked');
    expect(fixture.nativeElement.classList.contains('armed')).toBe(false);
  });

  it('should arm first and activate on the second click', () => {
    const activated = vi.fn();
    component.activated.subscribe(activated);
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    button.click();
    fixture.detectChanges();
    expect(component.state()).toBe('armed');
    expect(fixture.nativeElement.classList.contains('armed')).toBe(true);
    expect(fixture.nativeElement.classList.contains('active')).toBe(false);
    expect(activated).not.toHaveBeenCalled();

    button.click();
    fixture.detectChanges();
    expect(component.state()).toBe('active');
    expect(fixture.nativeElement.classList.contains('active')).toBe(true);
    expect(activated).toHaveBeenCalledTimes(1);
  });

  it('should expose an externally confirmed active status', () => {
    component.status.set('active');
    fixture.detectChanges();

    expect(component.state()).toBe('active');
    expect(fixture.nativeElement.classList.contains('active')).toBe(true);
  });

  it('should deactivate with one click when active', () => {
    const deactivated = vi.fn();
    component.deactivated.subscribe(deactivated);
    component.status.set('active');
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    expect(component.state()).toBe('locked');
    expect(fixture.nativeElement.classList.contains('active')).toBe(false);
    expect(deactivated).toHaveBeenCalledTimes(1);
  });

  it('should lock again after the arming window expires', () => {
    vi.useFakeTimers();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    button.click();
    expect(component.state()).toBe('armed');

    vi.advanceTimersByTime(3_000);
    fixture.detectChanges();
    expect(component.state()).toBe('locked');
    expect(fixture.nativeElement.classList.contains('armed')).toBe(false);
  });
});
