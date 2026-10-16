import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { BaseStationConnection } from '../../../core/ros/base-station-connection';
import { RosConnection } from '../../../core/ros/ros-connection';
import { RosConnectionButton } from './ros-connection-button';

describe('RosConnectionButton', () => {
  let fixture: ComponentFixture<RosConnectionButton>;
  let roverConnect: ReturnType<typeof vi.fn>;
  let baseStationConnect: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RosConnectionButton] }).compileComponents();
    roverConnect = vi.spyOn(TestBed.inject(RosConnection), 'connect');
    baseStationConnect = vi.spyOn(TestBed.inject(BaseStationConnection), 'connect');
    fixture = TestBed.createComponent(RosConnectionButton); fixture.detectChanges();
  });
  it('opens both fixed ROS links without an endpoint dialog', () => {
    expect(fixture.nativeElement.textContent).toContain('ROS Link');
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    expect(roverConnect).toHaveBeenCalledWith('localhost:9090');
    expect(baseStationConnect).toHaveBeenCalledWith('localhost:9091');
  });
});
