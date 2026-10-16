# Media gateway

BaseStation MediaMTX is the browser-facing camera service. It pulls the
`front`, `gimbal`, and `arm` RTSP paths from Rover MediaMTX, then serves those
paths to the hosted GUI through the BaseStation `/media/` proxy route.

Set `ROVER_RTSP_HOST` to the Rover static LAN IP. Set
`MEDIA_WEBRTC_ADDITIONAL_HOSTS` to the BaseStation static LAN IP so browser
WebRTC clients receive usable ICE candidates. Browser WHEP signalling is
proxied from `http://basestation.local/media/<camera>/whep`. WebRTC media uses
BaseStation UDP port `8189`.
