import { environment } from '../../../environments/environment';

export type CameraId = 'front' | 'gimbal' | 'arm';

export interface CameraSource {
  readonly id: CameraId;
  readonly label: string;
  readonly whepUrl: string;
}

export const CAMERA_GATEWAY_URL = environment.cameraGatewayUrl;

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
