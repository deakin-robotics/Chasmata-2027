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
  });

  it('should render a top-down rover with six wheels and four camera markers', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('svg')).toBeTruthy();
    expect(element.querySelectorAll('[data-wheel]')).toHaveLength(6);
    expect(element.querySelectorAll('[data-camera]')).toHaveLength(4);
  });
});
