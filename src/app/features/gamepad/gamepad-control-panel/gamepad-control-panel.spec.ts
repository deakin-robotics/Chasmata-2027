import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GamepadControlPanel } from './gamepad-control-panel';

describe('GamepadControlPanel', () => {
  let component: GamepadControlPanel;
  let fixture: ComponentFixture<GamepadControlPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GamepadControlPanel],
    }).compileComponents();

    fixture = TestBed.createComponent(GamepadControlPanel);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the gamepad schematic', () => {
    expect(fixture.nativeElement.querySelector('app-gamepad-schematic')).toBeTruthy();
  });

});
