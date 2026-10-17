const baseUrl = window.location.origin;

export const environment = {
  cameraGatewayUrl: `${baseUrl}/media`,
  cameraHealthUrl: `${baseUrl}/camera-health/cameras/status`,
  rosbridgeUrl: '/ros/rover',
  basestationRosbridgeUrl: '/ros/basestation',
} as const;
