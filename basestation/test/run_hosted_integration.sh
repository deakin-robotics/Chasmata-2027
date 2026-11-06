#!/usr/bin/env bash
set -euo pipefail
fixture=basestation-test-upstreams
web=basestation-test-web
gateway=basestation-test-gateway
health=basestation-test-health
camera=basestation-test-camera

cleanup() {
  for container in "$web" "$camera" "$health" "$gateway" "$fixture"; do
    docker logs "$container" 2>&1 || true
  done
  docker rm -f "$web" "$camera" "$health" "$gateway" "$fixture" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Start the test upstreams and give the web, gateway and camera containers one network namespace.
docker create --name "$fixture" -p 127.0.0.1::80 basestation-camera-health-ci python -u /tmp/hosted_upstreams.py >/dev/null
docker cp basestation/test/hosted_upstreams.py "$fixture:/tmp/hosted_upstreams.py"
docker start "$fixture" >/dev/null
docker run -d --name "$gateway" --network "container:$fixture" \
  -e MTX_API=yes -e MTX_APIADDRESS=:9997 -e MTX_AUTHINTERNALUSERS_2_USER=any \
  -e MTX_AUTHINTERNALUSERS_2_PERMISSIONS_0_ACTION=api bluenviron/mediamtx:1.21.1 >/dev/null
docker run -d --name "$health" --network "container:$fixture" \
  -e MEDIAMTX_API_URL=http://127.0.0.1:9997/v3/paths/list basestation-camera-health-ci >/dev/null
docker run -d --name "$web" --network "container:$fixture" -e ROVER_HOST=127.0.0.1 basestation-web-ci >/dev/null
docker run -d --name "$camera" --network "container:$fixture" -e BASE_STATION_MEDIA_HOST=127.0.0.1 \
  --entrypoint /usr/local/bin/camera-supervisor rover-camera-ci >/dev/null
port=$(docker port "$fixture" 80/tcp | head -n 1 | awk -F: '{print $NF}')
export BASESTATION_TEST_URL="http://127.0.0.1:$port"

# Wait for the actual gateway to receive all three mock camera streams.
wait_for_cameras() {
  local deadline=$((SECONDS + 90))
  while (( SECONDS < deadline )); do
    if curl -fsS --max-time 2 "$BASESTATION_TEST_URL/camera-health/cameras/status" 2>/dev/null |
      python3 -c 'import json,sys; x=json.load(sys.stdin); sys.exit(not (x["gatewayAvailable"] and all(x["cameras"].get(n) is True for n in ("front", "gimbal", "arm"))))' 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  echo 'Timed out waiting for the three camera streams.' >&2
  return 1
}

wait_for_cameras
python3 basestation/test/hosted_routes.py

# Verify that all three paths recover through the hosted route after gateway restart.
source_started=$(docker inspect -f '{{.State.StartedAt}}' "$camera")
docker restart "$gateway" >/dev/null
wait_for_cameras
test "$(docker inspect -f '{{.State.StartedAt}}' "$camera")" = "$source_started"
python3 basestation/test/hosted_routes.py
