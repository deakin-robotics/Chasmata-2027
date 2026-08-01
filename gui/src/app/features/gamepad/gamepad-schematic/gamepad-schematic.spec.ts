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
});
