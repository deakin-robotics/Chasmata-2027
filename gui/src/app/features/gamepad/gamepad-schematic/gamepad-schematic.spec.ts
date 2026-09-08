import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GamepadSchematic } from './gamepad-schematic';

describe('GamepadSchematic', () => {
  let component: GamepadSchematic;
  let fixture: ComponentFixture<GamepadSchematic>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GamepadSchematic],
    }).compileComponents();

    fixture = TestBed.createComponent(GamepadSchematic);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the controller SVG', () => {
    expect(fixture.nativeElement.querySelector('svg.controller')).toBeTruthy();
  });

  it('should render shoulder and trigger indicators', () => {
    expect(fixture.nativeElement.querySelectorAll('.shoulder-buttons .shoulder')).toHaveLength(2);
    expect(fixture.nativeElement.querySelectorAll('.triggers .trigger-track')).toHaveLength(2);
    expect(fixture.nativeElement.querySelectorAll('.triggers .trigger-fill')).toHaveLength(2);
  });
});
