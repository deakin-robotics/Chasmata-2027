import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ActionButton } from './action-button';

describe('ActionButton', () => {
  let component: ActionButton;
  let fixture: ComponentFixture<ActionButton>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ActionButton],
    }).compileComponents();

    fixture = TestBed.createComponent(ActionButton);
    fixture.componentRef.setInput('label', 'ROS Link');
    fixture.componentRef.setInput('actionLabel', 'Connect');
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display its action label', () => {
    expect(fixture.nativeElement.textContent).toContain('ROS Link');
    expect(fixture.nativeElement.textContent).toContain('Connect');
  });
});
