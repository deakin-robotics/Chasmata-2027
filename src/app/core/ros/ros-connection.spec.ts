import { TestBed } from '@angular/core/testing';

import { RosConnection } from './ros-connection';

describe('RosConnection', () => {
  let service: RosConnection;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(RosConnection);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should start disconnected', () => {
    expect(service.status()).toBe('disconnected');
    expect(service.isConnected()).toBe(false);
    expect(service.client()).toBeNull();
  });

  it('should reject an empty endpoint without opening a connection', () => {
    service.connect('   ');

    expect(service.status()).toBe('error');
    expect(service.error()).toBe('A ROSbridge URL is required.');
    expect(service.client()).toBeNull();
  });

  it('should report an error when reconnecting before configuration', () => {
    service.reconnect();

    expect(service.status()).toBe('error');
    expect(service.error()).toBe('No ROSbridge URL has been configured.');
  });

  it('should return to a clean disconnected state', () => {
    service.connect('');
    service.disconnect();

    expect(service.status()).toBe('disconnected');
    expect(service.error()).toBeNull();
    expect(service.url()).toBeNull();
    expect(service.reconnectAttempt()).toBe(0);
  });
});
