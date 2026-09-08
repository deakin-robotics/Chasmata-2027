import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RoverSchematic } from './rover-schematic';

describe('RoverSchematic', () => {
  let component: RoverSchematic;
  let fixture: ComponentFixture<RoverSchematic>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RoverSchematic],
    }).compileComponents();

    fixture = TestBed.createComponent(RoverSchematic);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
    expect(component.commandedGimbalYawDeg()).toBe(90);
    expect(component.actualGimbalYawDeg()).toBe(0);
    expect(component.commandedArmYawDeg()).toBe(0);
    expect(component.actualArmYawDeg()).toBe(0);
  });

  it('should render a top-down rover with four wheels and a front camera marker', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('svg')).toBeTruthy();
    expect(element.querySelectorAll('[data-wheel]')).toHaveLength(4);
    expect(element.querySelectorAll('[data-camera]')).toHaveLength(1);
    expect(element.querySelector('.gimbal-commanded')).toBeTruthy();
    expect(element.querySelector('.gimbal-actual')).toBeTruthy();
    expect(element.querySelector('.arm-commanded')).toBeFalsy();
    expect(element.querySelector('.arm-actual')).toBeTruthy();
    expect(element.querySelector('.arm-clamp')).toBeTruthy();
    expect(element.querySelector('.arm-pivot')).toBeTruthy();
    expect(element.querySelector('.arm-actual')?.getAttribute('transform')).toBe(
      'rotate(0 160 165)',
    );
  });
});
