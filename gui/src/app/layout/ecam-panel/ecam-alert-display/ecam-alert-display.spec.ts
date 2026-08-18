import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EcamAlertService } from '../../../core/ecam/ecam-alert.service';
import { EcamAlertDisplay } from './ecam-alert-display';

describe('EcamAlertDisplay', () => {
  let component: EcamAlertDisplay;
  let fixture: ComponentFixture<EcamAlertDisplay>;
  let ecamAlerts: EcamAlertService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EcamAlertDisplay],
    }).compileComponents();

    ecamAlerts = TestBed.inject(EcamAlertService);
    ecamAlerts.clearAll();
    fixture = TestBed.createComponent(EcamAlertDisplay);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should show the empty state when no alerts are active', () => {
    expect(component).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('No active messages');
  });

  it('should display active alerts in their catalogue severity order', () => {
    ecamAlerts.raise('CONFIG_ANTENNA_NOT_DEPLOYED');
    ecamAlerts.raise('CONFIG_ESTOP_STATUS_UNAVAILABLE');
    ecamAlerts.raise('CONFIG_LAW_DIRECT');
    fixture.detectChanges();

    const rows = Array.from(
      fixture.nativeElement.querySelectorAll('.alert'),
    ) as HTMLElement[];

    expect(rows.map((row) => row.querySelector('.alert-text')?.textContent?.trim())).toEqual([
      'CONFIG E-STOP STATUS UNAVAILABLE',
      'CONFIG LAW DIRECT',
      'CONFIG ANTENNA NOT DEPLOYED',
    ]);
    expect(rows.map((row) => row.className)).toEqual([
      'alert severity-fault',
      'alert severity-warning',
      'alert severity-attention',
    ]);
  });

  it('should populate representative alerts when T/O CONFIG is selected', () => {
    fixture.nativeElement.querySelector('button').click();
    fixture.detectChanges();

    expect(component.takeoffConfigResult()).toBe('FAILED');
    expect(fixture.nativeElement.querySelector('button').classList).toContain('config-warning');
    expect(ecamAlerts.activeAlerts().map((alert) => alert.code)).toEqual([
      'CONFIG_ESTOP_STATUS_UNAVAILABLE',
      'CONFIG_LAW_DIRECT',
      'CONFIG_ANTENNA_NOT_DEPLOYED',
    ]);
  });

  it('maps a confirmed normal result to the green button state', () => {
    component.takeoffConfigResult.set('NORMAL');
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.classList).toContain('config-normal');
  });
});
