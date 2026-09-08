import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ControlPanelShell, ControlPanelTab } from './control-panel-shell';

describe('ControlPanelShell', () => {
  let component: ControlPanelShell;
  let fixture: ComponentFixture<ControlPanelShell>;

  const tabs: readonly ControlPanelTab[] = [
    { id: 'master', label: 'Master' },
    { id: 'mode', label: 'Mode' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ControlPanelShell],
    }).compileComponents();

    fixture = TestBed.createComponent(ControlPanelShell);
    fixture.componentRef.setInput('label', 'Arm control panel');
    fixture.componentRef.setInput('tabs', tabs);
    fixture.componentRef.setInput('activeTab', 'master');
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render and switch tabs', () => {
    const tabElements = fixture.nativeElement.querySelectorAll(
      '.tab-button',
    ) as NodeListOf<HTMLButtonElement>;

    expect(tabElements).toHaveLength(2);
    expect(tabElements[0].getAttribute('aria-selected')).toBe('true');

    tabElements[1].click();
    fixture.detectChanges();

    expect(component.activeTab()).toBe('mode');
    expect(tabElements[1].getAttribute('aria-selected')).toBe('true');
  });
});
