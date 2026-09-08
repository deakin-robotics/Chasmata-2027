import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ControlModeOption, ControlModeSelector } from './control-mode-selector';

describe('ControlModeSelector', () => {
  let component: ControlModeSelector;
  let fixture: ComponentFixture<ControlModeSelector>;

  const options: readonly ControlModeOption[] = [
    { label: 'Manual', value: 'MANUAL' },
    { label: 'Position', value: 'POSITION' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ControlModeSelector],
    }).compileComponents();

    fixture = TestBed.createComponent(ControlModeSelector);
    fixture.componentRef.setInput('label', 'Arm control mode');
    fixture.componentRef.setInput('options', options);
    fixture.componentRef.setInput('value', 'POSITION');
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  it('should create with one active option', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('button.active')).toHaveLength(1);
  });

  it('should emit a selected option', () => {
    const selected: string[] = [];
    component.valueChange.subscribe((value) => selected.push(value));

    const buttons = fixture.nativeElement.querySelectorAll(
      'button',
    ) as NodeListOf<HTMLButtonElement>;
    buttons[0].click();

    expect(selected).toEqual(['MANUAL']);
  });

  it('should ignore values outside its options', () => {
    const selected: string[] = [];
    component.valueChange.subscribe((value) => selected.push(value));

    component.select('UNKNOWN');

    expect(selected).toEqual([]);
  });

  it('should disable selection when disabled', () => {
    const selected: string[] = [];
    component.valueChange.subscribe((value) => selected.push(value));

    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll(
      'button',
    ) as NodeListOf<HTMLButtonElement>;
    buttons[0].click();

    expect([...buttons].every((button) => button.disabled)).toBe(true);
    expect(selected).toEqual([]);
  });
});
