import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GamepadControlPanel } from './gamepad-control-panel';

describe('GamepadControlPanel', () => {
  let fixture: ComponentFixture<GamepadControlPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GamepadControlPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(GamepadControlPanel);
    fixture.detectChanges();
  });

  it('should render the gamepad schematic', () => {
    expect(fixture.nativeElement.querySelector('app-gamepad-schematic')).toBeTruthy();
  });

});
