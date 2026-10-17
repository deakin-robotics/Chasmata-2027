import { CAMERA_SOURCES } from './camera-sources';

describe('camera sources', () => {
  it('defines the BaseStation WHEP endpoint for each camera', () => {
    expect(Object.keys(CAMERA_SOURCES)).toEqual(['front', 'gimbal', 'arm']);
    expect(CAMERA_SOURCES.front).toEqual({
      id: 'front',
      label: 'Front camera',
      whepUrl: 'http://localhost:8889/front/whep',
    });
    expect(CAMERA_SOURCES.gimbal.whepUrl).toBe('http://localhost:8889/gimbal/whep');
    expect(CAMERA_SOURCES.arm.whepUrl).toBe('http://localhost:8889/arm/whep');
  });
});
