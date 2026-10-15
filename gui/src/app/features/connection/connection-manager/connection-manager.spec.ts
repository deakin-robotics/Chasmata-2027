import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

import { BaseStationConnection } from '../../../core/ros/base-station-connection';
import { RosConnection } from '../../../core/ros/ros-connection';
import { ConnectionManager } from './connection-manager';

describe('ConnectionManager', () => {
  let component: ConnectionManager;
  let fixture: ComponentFixture<ConnectionManager>;
  let rosConnection: RosConnection;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConnectionManager],
    }).compileComponents();

    fixture = TestBed.createComponent(ConnectionManager);
    component = fixture.componentInstance;
    rosConnection = TestBed.inject(RosConnection);
    fixture.detectChanges();
  });

  it('should render the initial disconnected state', () => {
    const element = fixture.nativeElement as HTMLElement;
    const endpointInput = element.querySelector('input') as HTMLInputElement;

    expect(element.textContent).toContain('Disconnected');
    expect(endpointInput.value).toBe('localhost:9090');
  });

  it('should pass the entered endpoint to the connection service', () => {
    const connectSpy = vi.spyOn(rosConnection, 'connect').mockImplementation(() => {});
    component.endpoint.setValue('localhost:9090');

    component.connect();

    expect(connectSpy).toHaveBeenCalledWith('localhost:9090');
  });

  it('should disconnect through the connection service', () => {
    const disconnectSpy = vi.spyOn(rosConnection, 'disconnect');

    component.disconnect();

    expect(disconnectSpy).toHaveBeenCalledOnce();
  });
});

describe('BaseStation ConnectionManager', () => {
  let component: ConnectionManager;
  let fixture: ComponentFixture<ConnectionManager>;
  let connection: BaseStationConnection;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConnectionManager],
      providers: [{ provide: MAT_DIALOG_DATA, useValue: { target: 'basestation' } }],
    }).compileComponents();

    fixture = TestBed.createComponent(ConnectionManager);
    component = fixture.componentInstance;
    connection = TestBed.inject(BaseStationConnection);
    fixture.detectChanges();
  });

  it('shows the independent BaseStation endpoint and connection state', () => {
    const element = fixture.nativeElement as HTMLElement;
    const endpointInput = element.querySelector('input') as HTMLInputElement;

    expect(element.textContent).toContain('BaseStation connection');
    expect(element.textContent).toContain('Disconnected');
    expect(endpointInput.value).toBe('localhost:9091');
  });

  it('connects the BaseStation service to the entered endpoint', () => {
    const connectSpy = vi.spyOn(connection, 'connect').mockImplementation(() => {});
    const roverConnectSpy = vi.spyOn(TestBed.inject(RosConnection), 'connect');
    component.endpoint.setValue('basestation.local:9091');

    component.connect();

    expect(connectSpy).toHaveBeenCalledWith('basestation.local:9091');
    expect(roverConnectSpy).not.toHaveBeenCalled();
  });

  it('disconnects only the BaseStation service', () => {
    const disconnectSpy = vi.spyOn(connection, 'disconnect');

    component.disconnect();

    expect(disconnectSpy).toHaveBeenCalledOnce();
  });
});
