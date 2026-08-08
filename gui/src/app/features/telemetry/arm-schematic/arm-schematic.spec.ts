import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArmSchematic } from './arm-schematic';

describe('ArmSchematic', () => {
  let component: ArmSchematic;
  let fixture: ComponentFixture<ArmSchematic>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArmSchematic],
    }).compileComponents();

    fixture = TestBed.createComponent(ArmSchematic);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the schematic placeholder', () => {
    expect(fixture.nativeElement.textContent).toContain('Arm schematic');
  });
});
