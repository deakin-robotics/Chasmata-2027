import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArmControlPanel } from './arm-control-panel';

describe('ArmControlPanel', () => {
  let fixture: ComponentFixture<ArmControlPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArmControlPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(ArmControlPanel);
    fixture.detectChanges();
  });

  it('should render the Master page by default', () => {
    expect(fixture.nativeElement.textContent).toContain('Master Drive');
    expect(fixture.nativeElement.querySelector('app-arm-master-page')).toBeTruthy();
  });

  it('should render the Master tab', () => {
    const tabElements = fixture.nativeElement.querySelectorAll(
      '.tab-button',
    ) as NodeListOf<HTMLElement>;
    const tabs = Array.from(tabElements).map((tab) => tab.textContent.trim());

    expect(tabs).toEqual(['Master']);
  });
});
