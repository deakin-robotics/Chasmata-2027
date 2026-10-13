import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ControlSwitch } from './control-switch';

describe('ControlSwitch', () => {
  let fixture: ComponentFixture<ControlSwitch>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ControlSwitch],
    }).compileComponents();

    fixture = TestBed.createComponent(ControlSwitch);
    fixture.componentRef.setInput('label', 'Master Drive');
    fixture.detectChanges();
  });

  it('should display its label', () => {
    expect(fixture.nativeElement.textContent).toContain('Master Drive');
  });
});
