import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BirdView } from './bird-view';

describe('BirdView', () => {
  let component: BirdView;
  let fixture: ComponentFixture<BirdView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BirdView],
    }).compileComponents();

    fixture = TestBed.createComponent(BirdView);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should identify the unavailable bird\'s-eye view', () => {
    expect(fixture.nativeElement.textContent).toContain("Bird's-eye view");
    expect(fixture.nativeElement.textContent).toContain('Camera view not available yet.');
  });
});
