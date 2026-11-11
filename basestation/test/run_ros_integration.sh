#!/usr/bin/env bash
set -euo pipefail
base=basestation-ci-ros
mock=basestation-ci-mock

cleanup() {
  docker logs "$base" 2>&1 | tail -n 200 || true
  docker logs "$mock" 2>&1 | tail -n 100 || true
  docker rm -f "$mock" "$base" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Launch MoveIt and the mock rover in a dedicated ROS domain and shared local IPC namespace.
docker run -d --name "$base" --network none --ipc shareable \
  -e ROS_DOMAIN_ID=147 -e ROS_LOCALHOST_ONLY=1 basestation-ci >/dev/null
docker run -d --name "$mock" --network "container:$base" --ipc "container:$base" \
  -e ROS_DOMAIN_ID=147 -e ROS_LOCALHOST_ONLY=1 --entrypoint /bin/bash rover-ci -lc \
  'source /opt/ros/jazzy/setup.bash && source /workspace/install/setup.bash && exec ros2 run rover rover' >/dev/null
docker cp basestation/test/ros_integration.py "$base:/tmp/ros_integration.py"

# Exercise heartbeat, joint feedback and Position planning against the real nodes.
timeout 240 docker exec "$base" bash -lc \
  'source /opt/ros/jazzy/setup.bash && source /workspace/install/setup.bash && python3 /tmp/ros_integration.py'

# Replace the mock action server with a controlled rover fixture to test rejection and execution failure.
docker stop "$mock" >/dev/null
docker cp basestation/test/fake_rover.py "$base:/tmp/fake_rover.py"
docker cp basestation/test/ros_failure_integration.py "$base:/tmp/ros_failure_integration.py"
docker exec -d "$base" bash -lc \
  'source /opt/ros/jazzy/setup.bash && source /workspace/install/setup.bash && exec python3 /tmp/fake_rover.py'
timeout 120 docker exec "$base" bash -lc \
  'source /opt/ros/jazzy/setup.bash && source /workspace/install/setup.bash && python3 /tmp/ros_failure_integration.py'
