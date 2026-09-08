import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArmModelViewer } from './arm-model-viewer';

describe('ArmModelViewer', () => {
  let fixture: ComponentFixture<ArmModelViewer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArmModelViewer],
    }).compileComponents();

    fixture = TestBed.createComponent(ArmModelViewer);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the model viewer shell', () => {
    expect(fixture.nativeElement.querySelector('[aria-label="Arm 3D model viewer"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.scene-host')).toBeTruthy();
  });

  it('should show the unavailable overlay without rendering while ROS is disconnected', () => {
    expect(fixture.componentInstance.rosConnected()).toBe(false);
    expect(fixture.nativeElement.querySelector('app-unavailable-overlay')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('canvas')).toBeFalsy();
  });
});
