import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UnavailableOverlay } from './unavailable-overlay';

describe('UnavailableOverlay', () => {
  let fixture: ComponentFixture<UnavailableOverlay>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UnavailableOverlay],
    }).compileComponents();

    fixture = TestBed.createComponent(UnavailableOverlay);
    fixture.componentRef.setInput('label', 'Control mapping unavailable');
    fixture.detectChanges();
  });

  it('should render a labelled unavailable overlay', () => {
    expect(fixture.nativeElement.querySelector('svg')?.getAttribute('aria-label')).toBe(
      'Control mapping unavailable',
    );
  });
});
