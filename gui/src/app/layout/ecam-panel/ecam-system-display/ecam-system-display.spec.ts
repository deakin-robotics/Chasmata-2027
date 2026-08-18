import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EcamSystemDisplay } from './ecam-system-display';

describe('EcamSystemDisplay', () => {
  let component: EcamSystemDisplay;
  let fixture: ComponentFixture<EcamSystemDisplay>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EcamSystemDisplay],
    }).compileComponents();

    fixture = TestBed.createComponent(EcamSystemDisplay);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the DRIVE schematic by default', () => {
    expect(component.selectedPage()).toBe('DRIVE');
    expect(fixture.nativeElement.textContent).toContain('DRIVE NORMAL');
  });

  it('switches to the selected symbolic system page', () => {
    const armButton = fixture.nativeElement.querySelector(
      'button[aria-label="System page: ARM"]',
    ) as HTMLButtonElement;

    armButton.click();
    fixture.detectChanges();

    expect(component.selectedPage()).toBe('ARM');
    expect(fixture.nativeElement.textContent).toContain('CAN');
  });
});
