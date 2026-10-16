# BaseStation networking

The BaseStation is the one operator-facing network appliance. Operator PCs open
the BaseStation website and do not need ROS, Docker, an Angular build, or Rover
address configuration.

| Browser path | BaseStation destination | Purpose |
| --- | --- | --- |
| `/ros/rover` | Rover ROSbridge `ROVER_HOST:9090` | Rover controls, heartbeat, FMA, and arm telemetry |
| `/ros/basestation` | BaseStation ROSbridge `:9091` | BaseStation heartbeat and shared ECAM state |
| `/media/*` | BaseStation MediaMTX `:8889` | WHEP camera signalling |
| `/camera-health/*` | Camera health `:9998` | Read-only camera readiness |

MediaMTX advertises `BASESTATION_LAN_IP` for WebRTC UDP media on `8189`. Its
browser origins are generated from that IP, with `basestation.local` also
permitted when separate name resolution provides the alias.

## Required BaseStation `.env` values

| Variable | Purpose |
| --- | --- |
| `ROVER_HOST` | Rover static LAN IP used for Fast DDS discovery, ROSbridge, and MediaMTX RTSP |
| `BASESTATION_LAN_IP` | BaseStation static LAN IP advertised to browser WebRTC clients |

The trusted club LAN remains HTTP-only for this release. Command owns static
addresses, firewall access, and radio access between BaseStation and Rover.
Operator PCs need access only to `http://<BASESTATION_LAN_IP>/` and its
advertised WebRTC UDP port. The camera-health service is available only through
the BaseStation web proxy.
