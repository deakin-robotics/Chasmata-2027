import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArmControlPanel } from './arm-control-panel';

describe('ArmControlPanel', () => {
  let component: ArmControlPanel;
  let fixture: ComponentFixture<ArmControlPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArmControlPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(ArmControlPanel);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the Master page by default', () => {
    expect(fixture.nativeElement.textContent).toContain('Master Drive');
    expect(fixture.nativeElement.querySelector('app-arm-master-page')).toBeTruthy();
  });

  it('should render Control and Mode tabs', () => {
    const tabElements = fixture.nativeElement.querySelectorAll(
      '.tab-button',
    ) as NodeListOf<HTMLElement>;
    const tabs = Array.from(tabElements).map((tab) => tab.textContent.trim());

    expect(tabs).toEqual(['Master', 'Mode']);
  });

  it('should switch to the Mode page', () => {
    const tabs = fixture.nativeElement.querySelectorAll(
      '.tab-button',
    ) as NodeListOf<HTMLButtonElement>;

    tabs[1].click();
    fixture.detectChanges();

    expect(component.activeTab()).toBe('mode');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(fixture.nativeElement.querySelector('.active-tab')?.textContent.trim()).toBe('Mode');
    expect(fixture.nativeElement.textContent).not.toContain('Master Drive');
    expect(fixture.nativeElement.textContent).toContain('Arm control mode');
    expect(fixture.nativeElement.querySelector('app-arm-mode-page')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-arm-master-page')).toBeFalsy();
  });
});
