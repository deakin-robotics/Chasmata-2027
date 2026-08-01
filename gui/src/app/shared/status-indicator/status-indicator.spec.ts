import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StatusIndicator } from './status-indicator';

describe('StatusIndicator', () => {
  let component: StatusIndicator;
  let fixture: ComponentFixture<StatusIndicator>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StatusIndicator] }).compileComponents();
    fixture = TestBed.createComponent(StatusIndicator);
    fixture.componentRef.setInput('label', 'Gamepad');
    fixture.componentRef.setInput('status', 'Connected');
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => expect(component).toBeTruthy());

  it('should display the supplied label and status', () => {
    expect(fixture.nativeElement.textContent).toContain('Gamepad');
    expect(fixture.nativeElement.textContent).toContain('Connected');
  });
});
