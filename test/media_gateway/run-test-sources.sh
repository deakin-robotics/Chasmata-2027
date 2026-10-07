#!/bin/sh
set -eu

: "${MEDIA_WIDTH:=1280}"
: "${MEDIA_HEIGHT:=720}"
: "${MEDIA_FPS:=30}"
: "${MEDIA_BITRATE_KBPS:=2500}"
: "${MEDIA_BUFFER_KBPS:=5000}"
: "${MEDIA_KEYFRAME_INTERVAL:=30}"

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
  filter="$2"

  ffmpeg \
    -hide_banner \
    -loglevel warning \
    -re \
    -f lavfi \
    -i "testsrc2=size=${MEDIA_WIDTH}x${MEDIA_HEIGHT}:rate=${MEDIA_FPS}" \
    -vf "$filter" \
    -an \
    -c:v libx264 \
    -profile:v baseline \
    -level 3.1 \
    -preset ultrafast \
    -tune zerolatency \
    -pix_fmt yuv420p \
    -b:v "${MEDIA_BITRATE_KBPS}k" \
    -maxrate "${MEDIA_BITRATE_KBPS}k" \
    -bufsize "${MEDIA_BUFFER_KBPS}k" \
    -g "$MEDIA_KEYFRAME_INTERVAL" \
    -bf 0 \
    -f rtsp \
    -rtsp_transport tcp \
    "rtsp://media-gateway:8554/${name}" &

  pids="$pids $!"
}

publish_stream front 'null'
publish_stream gimbal 'hue=h=90'
publish_stream arm 'hue=h=180'

wait $pids
