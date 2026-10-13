import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { MissionControl } from './mission-control';

describe('MissionControl', () => {
  let fixture: ComponentFixture<MissionControl>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MissionControl],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(MissionControl);
    await fixture.whenStable();
  });

  it('should render shared mission-control chrome', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toContain('Mission Control');
    expect(element.textContent).toContain('DRIVE');
    expect(element.textContent).toContain('GIMBAL');
    expect(element.textContent).not.toContain('LINK');
    expect(element.querySelector('[aria-label="Open operator views"]')).toBeTruthy();
    expect(element.textContent).toContain('E-stop');
  });
});
