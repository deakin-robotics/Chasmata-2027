# Local WebRTC media gateway

The mock-rover Compose stack runs MediaMTX on `http://localhost:8889` and
publishes three synthetic H.264 RTSP sources into it:

The gateway and browser reader are pinned to MediaMTX v1.21.1.

```text
rtsp://media-gateway:8554/front
rtsp://media-gateway:8554/gimbal
rtsp://media-gateway:8554/arm
```

The Angular GUI reads the resulting WHEP sessions at:

```text
http://localhost:8889/front/whep
http://localhost:8889/gimbal/whep
http://localhost:8889/arm/whep
```

Run it from `test/mock_rover`:

```bash
docker compose up --build
```

With the stack running, verify that all three RTSP sources are ready in
MediaMTX:

```powershell
pwsh ./../media_gateway/smoke_test.ps1
```

The source profile defaults to 1280×720 at 30 FPS, 2500 kbps, and a 30-frame
keyframe interval. The `MEDIA_WIDTH`, `MEDIA_HEIGHT`, `MEDIA_FPS`,
`MEDIA_BITRATE_KBPS`, `MEDIA_BUFFER_KBPS`, and `MEDIA_KEYFRAME_INTERVAL`
environment variables override those defaults.
