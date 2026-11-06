# BaseStation tests

Run these commands from the repository root. The unit tests use Python's standard library:

```bash
python3 -m unittest discover -s basestation/test -v
docker compose -f basestation/docker-compose.yml config --quiet
docker compose -f basestation/docker-compose.local.yml config --quiet
```

Build the images and run the MoveIt and mock-rover integration tests:

```bash
docker build -f basestation/Dockerfile -t basestation-ci .
docker build -f rover/mock_rover/Dockerfile -t rover-ci .
bash basestation/test/run_ros_integration.sh
```

Build the remaining images and run the hosted-route and camera-recovery tests:

```bash
docker build -f basestation/operations-web/Dockerfile -t basestation-web-ci .
docker build -t basestation-camera-health-ci basestation/camera-health
docker build -f rover/mock_rover/Dockerfile.media-source -t rover-camera-ci rover/mock_rover
bash basestation/test/run_hosted_integration.sh
```

The hosted tests verify WebSocket routing and WHEP signalling against test upstreams and mock camera streams. The ROS tests use an isolated domain, the mock rover and a controlled action-server fixture; they do not require rover hardware.
