import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StatusIndicator } from './status-indicator';

describe('StatusIndicator', () => {
  let fixture: ComponentFixture<StatusIndicator>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StatusIndicator] }).compileComponents();
    fixture = TestBed.createComponent(StatusIndicator);
    fixture.componentRef.setInput('label', 'Gamepad');
    fixture.componentRef.setInput('status', 'Connected');
    fixture.detectChanges();
  });

  it('should display the supplied label and status', () => {
    expect(fixture.nativeElement.textContent).toContain('Gamepad');
    expect(fixture.nativeElement.textContent).toContain('Connected');
  });

  it('replaces the dot with a spinner when requested', () => {
    fixture.componentRef.setInput('spinner', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.status-spinner')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.status-dot')).toBeNull();
  });
});
