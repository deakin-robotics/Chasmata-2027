import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GamepadSchematic } from './gamepad-schematic';

describe('GamepadSchematic', () => {
  let fixture: ComponentFixture<GamepadSchematic>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GamepadSchematic],
    }).compileComponents();

    fixture = TestBed.createComponent(GamepadSchematic);
    fixture.detectChanges();
  });

  it('should render the controller SVG', () => {
    expect(fixture.nativeElement.querySelector('svg.controller')).toBeTruthy();
  });

});
