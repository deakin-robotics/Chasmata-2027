export const environment = {
  cameraGatewayUrl: 'http://basestation.local:8889',
  roverCameraGatewayUrl: 'http://rover.local:8889',
  cameraHealthUrl: 'http://basestation.local:9998/cameras/status',
  rosbridgeUrl: 'rover.local:9090',
  basestationRosbridgeUrl: 'basestation.local:9091',
} as const;
