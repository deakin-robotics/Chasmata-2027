import { CAMERA_SOURCES } from './camera-sources';

describe('camera sources', () => {
  it('defines base-station and rover WHEP endpoints for each camera', () => {
    expect(Object.keys(CAMERA_SOURCES)).toEqual(['front', 'gimbal', 'arm']);
    expect(CAMERA_SOURCES.front).toEqual({
      id: 'front',
      label: 'Front camera',
      whepUrl: 'http://localhost:8889/front/whep',
      roverWhepUrl: 'http://localhost:8890/front/whep',
    });
    expect(CAMERA_SOURCES.gimbal.whepUrl).toBe('http://localhost:8889/gimbal/whep');
    expect(CAMERA_SOURCES.gimbal.roverWhepUrl).toBe('http://localhost:8890/gimbal/whep');
    expect(CAMERA_SOURCES.arm.whepUrl).toBe('http://localhost:8889/arm/whep');
    expect(CAMERA_SOURCES.arm.roverWhepUrl).toBe('http://localhost:8890/arm/whep');
  });
});
