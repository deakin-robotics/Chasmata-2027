export type CameraId = 'front' | 'gimbal' | 'arm';

export interface CameraSource {
  readonly id: CameraId;
  readonly label: string;
  readonly whepUrl: string;
}

/**
 * The local development gateway. Deployment configuration can replace this
 * value when the GUI is pointed at the rover media gateway.
 */
export const CAMERA_GATEWAY_URL = 'http://localhost:8889';

export const CAMERA_SOURCES: Readonly<Record<CameraId, CameraSource>> = {
  front: {
    id: 'front',
    label: 'Front camera',
    whepUrl: `${CAMERA_GATEWAY_URL}/front/whep`,
  },
  gimbal: {
    id: 'gimbal',
    label: 'Gimbal camera',
    whepUrl: `${CAMERA_GATEWAY_URL}/gimbal/whep`,
  },
  arm: {
    id: 'arm',
    label: 'Arm camera',
    whepUrl: `${CAMERA_GATEWAY_URL}/arm/whep`,
  },
};
