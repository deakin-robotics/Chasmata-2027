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

  it('should render the front, side, and rear camera positions', () => {
    expect(fixture.nativeElement.querySelectorAll('app-camera-stream')).toHaveLength(4);
    expect(fixture.nativeElement.querySelector('app-rover-schematic')).toBeTruthy();
  });
});
