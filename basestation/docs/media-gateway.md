# Media gateway

The base station runs MediaMTX as the normal browser gateway. It pulls one RTSP
stream per camera from rover-side MediaMTX and provides WHEP/WebRTC playback to
operator browsers. The rover gateway is also the GUI's direct video fallback.
Neither gateway carries rover controls, telemetry, or MoveIt traffic.

## Ports and paths

| Purpose                   | Port                                                      | Direction                                          |
| ------------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| Rover RTSP                | TCP `8554`; local mock host port `8555`                   | Base MediaMTX pulls rover paths over TCP           |
| Base WHEP signalling      | TCP `8889`                                                | Operator browser -> base MediaMTX                  |
| Base WebRTC media and ICE | UDP `8189`                                                | Operator browser <-> base MediaMTX                 |
| Rover fallback WHEP / ICE | TCP `8889` / UDP `8189` production; local `8890` / `8190` | Eligible GUI tiles -> rover MediaMTX               |
| Camera readiness          | TCP `9998`                                                | Operator browser -> read-only base health endpoint |
| MediaMTX path API         | TCP `9997` inside Docker only                             | Read by the camera-health service                   |

MediaMTX exposes three named camera paths:

| Camera | RTSP path | WHEP playback endpoint |
| ------ | --------- | ---------------------- |
| Front  | `front`   | `/front/whep`          |
| Gimbal | `gimbal`  | `/gimbal/whep`         |
| Arm    | `arm`     | `/arm/whep`            |

For example, a browser accessing the base station at
`http://basestation.local:8889` plays Front through
`http://basestation.local:8889/front/whep`. Its rover fallback is
`http://rover.local:8889/front/whep`.

The GUI polls `GET http://basestation.local:9998/cameras/status` while in
fallback mode. That endpoint filters MediaMTX's internal path API to the three
camera readiness booleans; operator browsers do not need the full control API.

The full browser-side contract, reader lifecycle, viewer recovery behaviour,
and local camera runbook live in the GUI guide:
[WebRTC camera stream](../../gui/docs/webrtc-camera-stream.md).

## Configuration

The Compose service loads `mediamtx.yml`. Its browser ports can be overridden
with `MEDIA_WEBRTC_PORT` and `MEDIA_WEBRTC_UDP_PORT`.
`CAMERA_HEALTH_PORT` changes the public read-only readiness port.

Two base-station `.env` values matter for a real LAN:

| Variable                              | Plain meaning                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `MEDIA_WEBRTC_ADDITIONAL_HOSTS`       | The base station's static LAN IP. MediaMTX gives this address to browsers for their UDP video connection.                        |
| `MEDIA_WEBRTC_ALLOW_ORIGINS`          | Browser page origins permitted to request WHEP. The default covers a GUI served locally on each operator PC at `localhost:4200`. |
| `ROVER_RTSP_HOST` / `ROVER_RTSP_PORT` | The rover gateway address the base-station MediaMTX pulls from; set the rover's static LAN IP and port `8554`.                   |

For local Windows testing, create the shared Docker network once with
`docker network create chasmata-local-media`. The mock publishes inside its
Compose network to rover MediaMTX; the base-station gateway pulls over the
shared network from `rover-media-gateway:8554`. The mock also publishes host
port `8555` for other local RTSP testing. In production, the base gateway pulls
from the rover's TCP `8554` listener. Configure `ROVER_RTSP_HOST` with the
rover's static IP so the base-station Docker container does not depend on mDNS
resolution. The rover MediaMTX must advertise the rover's own LAN IP for
direct fallback, while the base gateway advertises the base station's LAN IP.
