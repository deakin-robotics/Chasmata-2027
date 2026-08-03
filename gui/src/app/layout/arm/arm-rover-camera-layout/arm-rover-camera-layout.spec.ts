import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArmRoverCameraLayout } from './arm-rover-camera-layout';

describe('ArmRoverCameraLayout', () => {
  let component: ArmRoverCameraLayout;
  let fixture: ComponentFixture<ArmRoverCameraLayout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArmRoverCameraLayout],
    }).compileComponents();

    fixture = TestBed.createComponent(ArmRoverCameraLayout);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the front and rear camera layout', () => {
    expect(fixture.nativeElement.textContent).toContain('Front camera');
    expect(fixture.nativeElement.textContent).toContain('Rear camera');
    expect(fixture.nativeElement.querySelector('app-rover-schematic')).toBeTruthy();
  });
});
