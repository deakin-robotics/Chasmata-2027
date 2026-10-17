# Media gateway

BaseStation MediaMTX is the browser-facing camera service. It pulls the
`front`, `gimbal`, and `arm` RTSP paths from Rover MediaMTX, then serves those
paths to the hosted GUI through the BaseStation `/media/` proxy route.

Set `ROVER_HOST` to the Rover static LAN IP. Production MediaMTX uses host
networking and automatically advertises BaseStation network interfaces for
WebRTC ICE candidates. Browser WHEP signalling is proxied from
`http://<base-station-lan-ip>/media/<camera>/whep`. WebRTC media uses
BaseStation UDP port `8189`.
