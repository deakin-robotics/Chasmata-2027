# Media gateway

MediaMTX runs on the base station. It receives one RTSP stream per rover camera
and provides WebRTC playback to operator browsers. It does not carry rover
controls, telemetry, or MoveIt traffic.

## Ports and paths

| Purpose | Port | Direction |
| --- | --- | --- |
| RTSP ingest | TCP `8554` | Rover camera pipeline -> MediaMTX |
| WHEP signalling | TCP `8889` | Operator browser -> MediaMTX |
| WebRTC media and ICE | UDP `8189` | Operator browser <-> MediaMTX |
| Development API | TCP `9997` | Development inspection only |

MediaMTX exposes three named camera paths:

| Camera | RTSP path | WHEP playback endpoint |
| --- | --- | --- |
| Front | `front` | `/front/whep` |
| Gimbal | `gimbal` | `/gimbal/whep` |
| Arm | `arm` | `/arm/whep` |

For example, a browser accessing the base station at
`http://basestation.local:8889` plays the Front camera through
`http://basestation.local:8889/front/whep`.

The full browser-side contract, reader lifecycle, viewer recovery behaviour,
and local camera runbook live in the GUI guide:
[WebRTC camera stream](../../gui/docs/webrtc-camera-stream.md).

## Configuration

The Compose service loads `mediamtx.yml`. Its port defaults can be overridden
with `MEDIA_RTSP_PORT`, `MEDIA_WEBRTC_PORT`, `MEDIA_WEBRTC_UDP_PORT`, and
`MEDIA_API_PORT`.

Two base-station `.env` values matter for a real LAN:

| Variable | Plain meaning |
| --- | --- |
| `MEDIA_WEBRTC_ADDITIONAL_HOSTS` | The base station's static LAN IP. MediaMTX gives this address to browsers for their UDP video connection. |
| `MEDIA_WEBRTC_ALLOW_ORIGINS` | Browser page origins permitted to request WHEP. The default covers a GUI served locally on each operator PC at `localhost:4200`. |

For local Windows testing, the synthetic publishers inside `test/mock_rover`
send RTSP to `host.docker.internal:8554`. On the real rover network, the rover
camera pipeline must reach the base station's TCP `8554` listener.
