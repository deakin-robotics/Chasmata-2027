#!/usr/bin/env bash
set -euo pipefail

network=rover-camera-ci-network
gateway=rover-camera-ci-gateway
source=rover-camera-ci-source

cleanup() {
  docker logs "$source" 2>&1 || true
  docker logs "$gateway" 2>&1 || true
  docker rm -f "$source" "$gateway" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network" >/dev/null
docker run -d --name "$gateway" --network "$network" --network-alias media-gateway \
  -e MTX_API=yes -e MTX_APIADDRESS=:9997 \
  -e MTX_AUTHINTERNALUSERS_2_USER=any -e MTX_AUTHINTERNALUSERS_2_PERMISSIONS_0_ACTION=api \
  -p 127.0.0.1::9997 bluenviron/mediamtx:1.21.1 >/dev/null
docker run -d --name "$source" --network "$network" \
  --entrypoint /usr/local/bin/camera-supervisor rover-camera-ci >/dev/null

# Check that the source stays alive and all three gateway paths report ready.
wait_for_streams() {
  local deadline=$((SECONDS + 90)) port
  while (( SECONDS < deadline )); do
    if [[ $(docker inspect -f '{{.State.Running}}' "$source") != true ]]; then
      echo 'Camera source exited unexpectedly.' >&2
      return 1
    fi
    port=$(docker port "$gateway" 9997/tcp 2>/dev/null | head -n 1 | awk -F: '{print $NF}')
    if [[ -n "$port" ]] && curl --silent --fail --max-time 2 "http://127.0.0.1:${port}/v3/paths/list" |
      python3 -c 'import json,sys; paths = json.load(sys.stdin)["items"]; sys.exit(not {"front", "gimbal", "arm"}.issubset({p["name"] for p in paths if p.get("ready")}))' 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  echo 'Timed out waiting for all three camera streams.' >&2
  return 1
}

# Verify all three cameras publish before interrupting the gateway.
echo 'Waiting for all three initial camera streams.'
wait_for_streams
source_started=$(docker inspect -f '{{.State.StartedAt}}' "$source")
# Verify all three cameras recover without restarting the source container.
echo 'Restarting the gateway while the camera source remains running.'
docker restart "$gateway" >/dev/null
wait_for_streams
test "$(docker inspect -f '{{.State.StartedAt}}' "$source")" = "$source_started"
echo 'All three streams recovered without restarting the source.'
