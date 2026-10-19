# Networking

## Addresses and configuration

Base station configures `ROVER_HOST` for the Rover ROSbridge and Fast DDS
discovery endpoint. Rover configures only `BASE_STATION_MEDIA_HOST` for camera
publishing. It can be a static Base station hostname or radio/LAN IP.

## Required flows

| Source | Destination | Port | Purpose |
| --- | --- | --- | --- |
| Operator browser | Base station operations web | TCP 80 | GUI, `/ros/*`, `/media/*`, and camera health proxy |
| Base station | Rover ROSbridge | TCP 9090 | Rover controls, heartbeat, FMA, and arm telemetry |
| Base station | Rover Fast DDS discovery | UDP 11811 | ROS discovery service |
| Rover camera publisher | Base station MediaMTX | TCP 8889 | WHIP signalling |
| Rover camera publisher <-> Base station MediaMTX | UDP 8189 | WebRTC media |
| Operator browser <-> Base station MediaMTX | UDP 8189 | Browser WebRTC media |
