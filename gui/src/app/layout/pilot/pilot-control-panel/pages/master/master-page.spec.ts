import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PilotMasterPage } from './master-page';

describe('PilotMasterPage', () => {
  let component: PilotMasterPage;
  let fixture: ComponentFixture<PilotMasterPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PilotMasterPage],
    }).compileComponents();

    fixture = TestBed.createComponent(PilotMasterPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the Pilot master controls', () => {
    expect(fixture.nativeElement.textContent).toContain('Master Drive');
    expect(fixture.nativeElement.textContent).toContain('ROS Link');
  });
});
