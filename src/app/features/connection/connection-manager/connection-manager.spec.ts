import { ComponentFixture, TestBed } from '@angular/core/testing';

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
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render the initial disconnected state', () => {
    const element = fixture.nativeElement as HTMLElement;
    const endpointInput = element.querySelector('input') as HTMLInputElement;

    expect(element.textContent).toContain('Disconnected');
    expect(endpointInput.value).toBe('localhost:9090');
  });

  it('should pass the entered endpoint to the connection service', () => {
    const connectSpy = vi.spyOn(rosConnection, 'connect');
    component.endpoint.setValue('rover.local:9090');

    component.connect();

    expect(connectSpy).toHaveBeenCalledWith('rover.local:9090');
  });

  it('should disconnect through the connection service', () => {
    const disconnectSpy = vi.spyOn(rosConnection, 'disconnect');

    component.disconnect();

    expect(disconnectSpy).toHaveBeenCalledOnce();
  });
});
