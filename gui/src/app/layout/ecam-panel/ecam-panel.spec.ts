import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EcamPanel } from './ecam-panel';

describe('EcamPanel', () => {
  let fixture: ComponentFixture<EcamPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EcamPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(EcamPanel);
    fixture.detectChanges();
  });

  it('should render the alert and system displays', () => {
    expect(fixture.nativeElement.textContent).toContain('ECAM');
    expect(fixture.nativeElement.textContent).toContain('T/O CONFIG');
    expect(fixture.nativeElement.textContent).toContain('DRIVE');
    expect(fixture.nativeElement.textContent).toContain('ROS Link');

    const headerControls = fixture.nativeElement.querySelector('.header-controls');
    expect(headerControls.children[0].getAttribute('aria-label')).toBe('ROS connections');
    expect(headerControls.children[1].getAttribute('role')).toBe('separator');
    expect(headerControls.children[2].classList).toContain('takeoff-config-button');
  });
});
