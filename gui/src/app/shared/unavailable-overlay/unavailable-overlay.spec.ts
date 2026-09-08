import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UnavailableOverlay } from './unavailable-overlay';

describe('UnavailableOverlay', () => {
  let component: UnavailableOverlay;
  let fixture: ComponentFixture<UnavailableOverlay>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UnavailableOverlay],
    }).compileComponents();

    fixture = TestBed.createComponent(UnavailableOverlay);
    fixture.componentRef.setInput('label', 'Control mapping unavailable');
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  it('should create a labelled red X overlay', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.querySelector('svg')?.getAttribute('aria-label')).toBe(
      'Control mapping unavailable',
    );
    expect(fixture.nativeElement.querySelectorAll('line')).toHaveLength(2);
  });
});
