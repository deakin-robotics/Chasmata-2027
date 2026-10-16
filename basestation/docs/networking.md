# BaseStation networking

The BaseStation is the one operator-facing network appliance. Operator PCs open
the BaseStation website and do not need ROS, Docker, an Angular build, or Rover
address configuration.

| Browser path | BaseStation destination | Purpose |
| --- | --- | --- |
| `/ros/rover` | Rover ROSbridge `ROVER_ROSBRIDGE_HOST:9090` | Rover controls, heartbeat, FMA, and arm telemetry |
| `/ros/basestation` | BaseStation ROSbridge `:9091` | BaseStation heartbeat and shared ECAM state |
| `/media/*` | BaseStation MediaMTX `:8889` | WHEP camera signalling |
| `/camera-health/*` | Camera health `:9998` | Read-only camera readiness |

MediaMTX advertises the BaseStation LAN IP for WebRTC UDP media on `8189`.
The website URL and its fixed-IP fallback must both be included in
`MEDIA_WEBRTC_ALLOW_ORIGINS`.

## Required BaseStation `.env` values

| Variable | Purpose |
| --- | --- |
| `ROVER_DISCOVERY_SERVER` | Rover Fast DDS discovery endpoint for BaseStation ROS services |
| `ROVER_ROSBRIDGE_HOST` / `ROVER_ROSBRIDGE_PORT` | Rover endpoint used only by the BaseStation web proxy |
| `ROVER_RTSP_HOST` / `ROVER_RTSP_PORT` | Rover MediaMTX source for the three BaseStation pulls |
| `MEDIA_WEBRTC_ADDITIONAL_HOSTS` | BaseStation static LAN IP advertised to browser ICE clients |
| `MEDIA_WEBRTC_ALLOW_ORIGINS` | `http://basestation.local` and the fixed-IP fallback |

The trusted club LAN remains HTTP-only for this release. Command owns static
addresses, name resolution, and firewall/radio access between BaseStation and
Rover. Operator PCs need access only to the BaseStation HTTP address and its
advertised WebRTC UDP port.
