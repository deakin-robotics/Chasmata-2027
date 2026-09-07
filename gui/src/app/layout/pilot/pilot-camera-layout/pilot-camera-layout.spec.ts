import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PilotCameraLayout } from './pilot-camera-layout';

describe('PilotCameraLayout', () => {
  let component: PilotCameraLayout;
  let fixture: ComponentFixture<PilotCameraLayout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PilotCameraLayout],
    }).compileComponents();

    fixture = TestBed.createComponent(PilotCameraLayout);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the Pilot camera layout', () => {
    expect(component).toBeTruthy();
  });

  it('should render the front camera position', () => {
    expect(fixture.nativeElement.querySelectorAll('app-camera-stream')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).not.toContain('Left side camera');
    expect(fixture.nativeElement.textContent).not.toContain('Right side camera');
    expect(fixture.nativeElement.textContent).not.toContain('Rear camera');
    expect(fixture.nativeElement.querySelector('app-rover-schematic')).toBeTruthy();
  });
});
