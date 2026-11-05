#!/bin/sh
set -eu

: "${MEDIA_WIDTH:=1280}"
: "${MEDIA_HEIGHT:=720}"
: "${MEDIA_FPS:=30}"
: "${MEDIA_BITRATE_KBPS:=2500}"
: "${MEDIA_BUFFER_KBPS:=5000}"
: "${MEDIA_KEYFRAME_INTERVAL:=30}"
: "${BASE_STATION_MEDIA_HOST:=media-gateway}"

pids=""

cleanup() {
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null || true
    wait $pids 2>/dev/null || true
  fi
}

trap cleanup INT TERM EXIT

publish_stream() {
  name="$1"
  pattern="$2"
  horizontal_speed="$3"
  buffer_ms=$((MEDIA_BUFFER_KBPS * 1000 / MEDIA_BITRATE_KBPS))

  gst-launch-1.0 -q \
    videotestsrc is-live=true pattern="$pattern" horizontal-speed="$horizontal_speed" \
    ! "video/x-raw,width=${MEDIA_WIDTH},height=${MEDIA_HEIGHT},framerate=${MEDIA_FPS}/1" \
    ! videoconvert \
    ! x264enc bitrate="$MEDIA_BITRATE_KBPS" speed-preset=ultrafast tune=zerolatency \
        key-int-max="$MEDIA_KEYFRAME_INTERVAL" bframes=0 vbv-buf-capacity="$buffer_ms" \
    ! "video/x-h264,profile=baseline" \
    ! whipclientsink congestion-control=disabled \
        signaller::whip-endpoint="http://${BASE_STATION_MEDIA_HOST}:8889/${name}/whip" &

  pids="$pids $!"
}

publish_stream front smpte 1
publish_stream gimbal smpte75 -2
publish_stream arm ball 0

wait $pids
