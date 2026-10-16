# Media gateway

BaseStation MediaMTX is the browser-facing camera service. It pulls the
`front`, `gimbal`, and `arm` RTSP paths from Rover MediaMTX, then serves those
paths to the hosted GUI through the BaseStation `/media/` proxy route.

Set `ROVER_HOST` to the Rover static LAN IP and `BASESTATION_LAN_IP` to the
BaseStation static LAN IP. MediaMTX uses the latter when advertising WebRTC ICE
candidates. Browser WHEP signalling is proxied from
`http://<BASESTATION_LAN_IP>/media/<camera>/whep`. WebRTC media uses
BaseStation UDP port `8189`.
