import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArmMode, DriveMode, FmaStateService } from '../../../core/fma/fma-state.service';
import { MissionControlFma } from './mission-control-fma';

describe('MissionControlFma', () => {
  let fixture: ComponentFixture<MissionControlFma>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MissionControlFma],
    }).compileComponents();
  });

  it('does not mutate shared FMA state when mounted or destroyed', () => {
    const fmaState = TestBed.inject(FmaStateService);
    fmaState.confirmDriveMode(DriveMode.Velocity);
    fmaState.requestArmMode(ArmMode.Position);
    const stateBeforeMount = fmaState.columns();

    fixture = TestBed.createComponent(MissionControlFma);
    fixture.detectChanges();
    fixture.destroy();

    expect(fmaState.columns()).toEqual(stateBeforeMount);
  });

  it('hides all FMA status values while ROS is disconnected', () => {
    fixture = TestBed.createComponent(MissionControlFma);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.mode')).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('app-unavailable-overlay')).toBeTruthy();
  });
});
