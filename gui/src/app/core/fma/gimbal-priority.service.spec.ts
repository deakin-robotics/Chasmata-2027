import { GimbalPriorityService } from './gimbal-priority.service';

describe('GimbalPriorityService', () => {
  it('starts unknown until authoritative owner telemetry is available', () => {
    const service = new GimbalPriorityService();

    expect(service.owner()).toBeNull();
    expect(service.display()).toBe('GIM PRI UNK');
  });

  it('formats each confirmed owner with the documented arrow', () => {
    const service = new GimbalPriorityService();

    service.setOwner('DRIVER');
    expect(service.display()).toBe('← DRIVER');

    service.setOwner('ARM OPS');
    expect(service.display()).toBe('ARM OPS →');
  });
});
