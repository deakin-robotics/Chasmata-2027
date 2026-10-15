import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { EcamAlertConsumerService } from '../../../core/ecam/ecam-alert-consumer.service';
import { EcamAlertReporterService } from '../../../core/ecam/ecam-alert-reporter.service';
import { EcamAlertDisplay } from './ecam-alert-display';

describe('EcamAlertDisplay', () => {
  let component: EcamAlertDisplay;
  let fixture: ComponentFixture<EcamAlertDisplay>;
  let ecamAlerts: EcamAlertReporterService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EcamAlertDisplay],
      providers: [provideRouter([])],
    }).compileComponents();

    ecamAlerts = TestBed.inject(EcamAlertReporterService);
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

    const rows = Array.from(fixture.nativeElement.querySelectorAll('.alert')) as HTMLElement[];

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
    expect(rows.map((row) => row.querySelector('.alert-source')?.textContent?.trim())).toEqual([
      'ECAM',
      'ECAM',
      'ECAM',
    ]);
  });

  it('shows all reporters on one alert row', () => {
    (
      TestBed.inject(EcamAlertConsumerService) as unknown as {
        handleAggregate: (value: unknown) => void;
      }
    ).handleAggregate({
      authority: 'basestation',
      timestamp: { sec: 123, nanosec: 0 },
      sources: [
        { source: 'driver', active_codes: ['ROVER_HEARTBEAT_LOST'] },
        { source: 'arm', active_codes: ['ROVER_HEARTBEAT_LOST'] },
      ],
    });
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.alert');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('.alert-source')?.textContent?.trim()).toBe('DRIVER · ARM');
  });

  it('should not seed demo alerts when T/O CONFIG is selected', () => {
    const takeoffConfigButton = fixture.nativeElement.querySelector(
      '.takeoff-config-button',
    ) as HTMLButtonElement;
    takeoffConfigButton.click();
    fixture.detectChanges();

    expect(component.takeoffConfigResult()).toBe('FAILED');
    expect(takeoffConfigButton.classList).toContain('config-warning');
    expect(ecamAlerts.localAlerts()).toEqual([]);
  });

  it('maps a confirmed normal result to the green button state', () => {
    component.takeoffConfigResult.set('NORMAL');
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      '.takeoff-config-button',
    ) as HTMLButtonElement;
    expect(button.classList).toContain('config-normal');
  });
});
