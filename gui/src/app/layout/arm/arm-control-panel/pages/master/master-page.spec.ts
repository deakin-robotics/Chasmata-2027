import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { ControlModeCoordinator } from '../../../../../core/control/control-mode-coordinator';
import { ArmControlModeService } from '../../../../../core/control/arm/arm-control-mode';
import { ArmRecovery } from '../../../../../core/control/arm/arm-recovery';
import { GamepadInput } from '../../../../../core/gamepad/gamepad-input';
import { ArmMode } from '../../../../../core/fma/fma-state.service';
import { BaseStationConnection } from '../../../../../core/ros/base-station-connection';
import { RosConnection, type RosConnectionStatus } from '../../../../../core/ros/ros-connection';
import { RosHeartbeatMonitor } from '../../../../../core/ros/ros-heartbeat-monitor';
import { ArmMasterPage } from './master-page';

describe('ArmMasterPage', () => {
  let fixture: ComponentFixture<ArmMasterPage>;
  let baseStationAvailable: ReturnType<typeof signal<boolean>>;
  let roverAvailable: ReturnType<typeof signal<boolean>>;
  let baseStationWasAvailable: ReturnType<typeof signal<boolean>>;
  let roverWasAvailable: ReturnType<typeof signal<boolean>>;
  let roverConnectionStatus: WritableSignal<RosConnectionStatus>;
  let baseStationConnectionStatus: WritableSignal<RosConnectionStatus>;
  let selectArmMode: ReturnType<typeof vi.fn>;
  let requestArmMode: ReturnType<typeof vi.fn>;
  let gamepadConnected: WritableSignal<boolean>;

  beforeEach(async () => {
    baseStationAvailable = signal(false);
    roverAvailable = signal(false);
    baseStationWasAvailable = signal(false);
    roverWasAvailable = signal(false);
    roverConnectionStatus = signal<RosConnectionStatus>('disconnected');
    baseStationConnectionStatus = signal<RosConnectionStatus>('disconnected');
    const roverStatus = signal('disconnected');
    const isRoverConnecting = signal(false);
    const connectionInProgress = signal(false);
    selectArmMode = vi.fn();
    requestArmMode = vi.fn();
    gamepadConnected = signal(true);

    await TestBed.configureTestingModule({
      imports: [ArmMasterPage],
      providers: [
        { provide: GamepadInput, useValue: {
          start: vi.fn(), stop: vi.fn(), connected: gamepadConnected.asReadonly(),
          snapshot: signal({ axes: [0, 0, 0, 0], buttons: [] }).asReadonly(),
          name: signal<string | null>(null).asReadonly(),
        } },
        {
          provide: RosHeartbeatMonitor,
          useValue: {
            baseStationAvailable: baseStationAvailable.asReadonly(),
            roverAvailable: roverAvailable.asReadonly(),
            baseStationWasAvailable: baseStationWasAvailable.asReadonly(),
            roverWasAvailable: roverWasAvailable.asReadonly(),
            roverStatus: roverStatus.asReadonly(),
            isRoverConnecting: isRoverConnecting.asReadonly(),
          },
        },
        {
          provide: RosConnection,
          useValue: {
            client: signal(null).asReadonly(),
            status: roverConnectionStatus.asReadonly(),
            isConnecting: connectionInProgress.asReadonly(),
            connect: vi.fn(),
            disconnect: vi.fn(),
          },
        },
        {
          provide: BaseStationConnection,
          useValue: {
            status: baseStationConnectionStatus.asReadonly(),
            isConnecting: connectionInProgress.asReadonly(),
            connect: vi.fn(),
            disconnect: vi.fn(),
          },
        },
        {
          provide: ControlModeCoordinator,
          useValue: {
            prepareArmModeRequest: vi.fn(),
            requestArmMode,
            selectArmMode,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArmMasterPage);
    fixture.detectChanges();
  });

  it('should render the Master page controls', () => {
    expect(fixture.nativeElement.textContent).toContain('Master Drive');
    expect(fixture.nativeElement.textContent).toContain('ROS Link');
    expect(fixture.nativeElement.textContent).toContain('Camera Link');
    expect(fixture.nativeElement.textContent).toContain('Gamepad');
    expect(fixture.nativeElement.textContent).toContain('Rover');
    expect(fixture.nativeElement.textContent).toContain('Base Station');
    expect(
      fixture.nativeElement.querySelector('.camera-feed button').getAttribute('aria-checked'),
    ).toBe('false');
    expect(fixture.nativeElement.textContent).toContain('Law Override');
    expect(fixture.nativeElement.textContent).toContain('Clear Faults');
    expect(
      fixture.nativeElement.querySelector('app-control-mode-selector.arm-mode-selector'),
    ).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.law-override button').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('.clear-faults button').disabled).toBe(true);
  });

  it.each([true, false])('shows the recovery result without requesting a mode, success=%s', async (success) => {
    roverAvailable.set(true);
    fixture.detectChanges();
    requestArmMode.mockClear();
    const rearm = vi.spyOn(TestBed.inject(ArmRecovery), 'rearm')
      .mockResolvedValue({ success, message: success ? 'Recovered' : 'Arm is inhibited' });
    const button = fixture.nativeElement.querySelector('.clear-faults button') as HTMLButtonElement;
    button.click(); fixture.detectChanges(); button.click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(rearm).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('.arm-recovery-message').textContent)
      .toContain(success ? 'Recovered' : 'Arm is inhibited');
    expect(requestArmMode).not.toHaveBeenCalled();
  });

  it('should enable the camera feed when switched on', () => {
    const button = fixture.nativeElement.querySelector('.camera-feed button') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.cameraFeedEnabled()).toBe(true);
    expect(button.getAttribute('aria-checked')).toBe('true');
  });

  it('keeps Master Drive on and changes its ring during connection loss', () => {
    roverAvailable.set(true);
    baseStationAvailable.set(true);
    expect(TestBed.inject(ArmControlModeService).enable()).toBe(true);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button[aria-label="Master Drive"]') as HTMLButtonElement;
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.classList.contains('tone-normal')).toBe(true);
    baseStationAvailable.set(false);
    fixture.detectChanges();
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.classList.contains('tone-caution')).toBe(true);
    baseStationAvailable.set(true);
    roverAvailable.set(false);
    fixture.detectChanges();
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.disabled).toBe(false);
    expect(button.classList.contains('tone-critical')).toBe(true);
    roverAvailable.set(true);
    gamepadConnected.set(false);
    fixture.detectChanges();
    expect(button.classList.contains('tone-critical')).toBe(true);
    gamepadConnected.set(true);
    fixture.detectChanges();
    expect(button.classList.contains('tone-normal')).toBe(true);
    button.click();
    expect(TestBed.inject(ArmControlModeService).enabled()).toBe(false);
  });

  it('reports the Rover lifecycle from connecting through a lost heartbeat', () => {
    roverConnectionStatus.set('connecting');
    fixture.detectChanges();
    expect(fixture.componentInstance.roverTopologyStatus()).toEqual({
      label: 'Connecting',
      tone: 'info',
    });
    expect(fixture.nativeElement.querySelector('.rover-status .status-spinner')).toBeTruthy();

    roverConnectionStatus.set('connected');
    fixture.detectChanges();
    expect(fixture.componentInstance.roverTopologyStatus()).toEqual({
      label: 'Awaiting',
      tone: 'info',
    });
    expect(fixture.nativeElement.querySelector('.rover-status .status-spinner')).toBeTruthy();

    roverAvailable.set(true);
    roverWasAvailable.set(true);
    fixture.detectChanges();
    expect(fixture.componentInstance.roverTopologyStatus()).toEqual({
      label: 'Online',
      tone: 'normal',
    });

    roverAvailable.set(false);
    fixture.detectChanges();
    expect(fixture.componentInstance.roverTopologyStatus()).toEqual({
      label: 'Lost',
      tone: 'critical',
    });

    roverConnectionStatus.set('disconnected');
    fixture.detectChanges();
    expect(fixture.componentInstance.roverTopologyStatus()).toEqual({
      label: 'Off',
      tone: 'neutral',
    });
  });

  it('requests Manual for a Rover-only link, then Position once BaseStation is online', () => {
    roverAvailable.set(true);
    fixture.detectChanges();

    expect(requestArmMode).toHaveBeenCalledOnce();
    expect(requestArmMode).toHaveBeenCalledWith(ArmMode.Manual);

    baseStationAvailable.set(true);
    baseStationWasAvailable.set(true);
    fixture.detectChanges();

    expect(requestArmMode).toHaveBeenLastCalledWith(ArmMode.Position);
    expect(requestArmMode).toHaveBeenCalledTimes(2);
  });

  it('does not repeat mode commands for unchanged link availability', () => {
    roverAvailable.set(true);
    fixture.detectChanges();
    fixture.detectChanges();

    expect(requestArmMode).toHaveBeenCalledOnce();
    expect(requestArmMode).toHaveBeenCalledWith(ArmMode.Manual);
  });

  it('requests Manual after BaseStation loss and Position after recovery', () => {
    roverAvailable.set(true);
    baseStationAvailable.set(true);
    baseStationWasAvailable.set(true);
    fixture.detectChanges();

    baseStationAvailable.set(false);
    fixture.detectChanges();

    baseStationAvailable.set(true);
    baseStationWasAvailable.set(true);
    fixture.detectChanges();

    expect(requestArmMode.mock.calls).toEqual([
      [ArmMode.Position],
      [ArmMode.Manual],
      [ArmMode.Position],
    ]);
  });

  it('requests the target mode again after Rover recovers', () => {
    roverAvailable.set(true);
    baseStationAvailable.set(true);
    fixture.detectChanges();

    roverAvailable.set(false);
    fixture.detectChanges();
    roverAvailable.set(true);
    fixture.detectChanges();

    expect(requestArmMode).toHaveBeenCalledTimes(2);
    expect(requestArmMode).toHaveBeenNthCalledWith(1, ArmMode.Position);
    expect(requestArmMode).toHaveBeenNthCalledWith(2, ArmMode.Position);
  });

  it('reports BaseStation heartbeat loss and connection errors independently', () => {
    baseStationConnectionStatus.set('connected');
    fixture.detectChanges();
    expect(fixture.componentInstance.baseStationTopologyStatus()).toEqual({
      label: 'Awaiting',
      tone: 'info',
    });
    expect(fixture.nativeElement.querySelector('.base-station-status .status-spinner')).toBeTruthy();

    baseStationAvailable.set(true);
    baseStationWasAvailable.set(true);
    fixture.detectChanges();
    expect(fixture.componentInstance.baseStationTopologyStatus()).toEqual({
      label: 'Online',
      tone: 'normal',
    });

    baseStationAvailable.set(false);
    fixture.detectChanges();
    expect(fixture.componentInstance.baseStationTopologyStatus()).toEqual({
      label: 'Lost',
      tone: 'critical',
    });

    baseStationConnectionStatus.set('error');
    fixture.detectChanges();
    expect(fixture.componentInstance.baseStationTopologyStatus()).toEqual({
      label: 'Lost',
      tone: 'critical',
    });
  });

  it('matches the Rover and BaseStation connector tones to their status nodes', () => {
    roverConnectionStatus.set('connected');
    baseStationConnectionStatus.set('connected');
    roverAvailable.set(true);
    baseStationAvailable.set(true);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.rover-flow')).componentInstance.tone()).toBe('normal');
    expect(fixture.debugElement.query(By.css('.base-station-stem')).componentInstance.tone()).toBe(
      'normal',
    );
    expect(fixture.debugElement.query(By.css('.base-station-flow')).componentInstance.tone()).toBe(
      'normal',
    );
  });

  it('can request the selected Manual mode again without BaseStation', () => {
    roverAvailable.set(true);
    fixture.detectChanges();
    requestArmMode.mockClear();
    const buttons = fixture.nativeElement.querySelectorAll('.arm-mode-selector button') as NodeListOf<HTMLButtonElement>;
    buttons[0].click();
    expect(requestArmMode).toHaveBeenCalledOnce();
    expect(requestArmMode).toHaveBeenCalledWith(ArmMode.Manual);
  });

  it('keeps Manual available but disables Position when BaseStation is lost', () => {
    roverAvailable.set(true);
    baseStationAvailable.set(true);
    fixture.detectChanges();
    expect(selectArmMode).not.toHaveBeenCalled();
    const selector = fixture.nativeElement.querySelector('.arm-mode-selector');
    const selectorControl = selector.querySelector('.control-mode-selector');
    const modeButtons = selector.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    expect(selectorControl.getAttribute('aria-disabled')).toBe('false');
    expect([...modeButtons].every((button) => !button.disabled)).toBe(true);

    baseStationAvailable.set(false);
    fixture.detectChanges();

    expect(requestArmMode).toHaveBeenCalledWith(ArmMode.Manual);
    expect(selectorControl.getAttribute('aria-disabled')).toBe('false');
    expect(modeButtons[0].disabled).toBe(false);
    expect(modeButtons[1].disabled).toBe(true);

    baseStationAvailable.set(true);
    fixture.detectChanges();
    expect(selectorControl.getAttribute('aria-disabled')).toBe('false');
    expect([...modeButtons].every((button) => !button.disabled)).toBe(true);
  });
});
