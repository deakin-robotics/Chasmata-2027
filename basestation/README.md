# Base station

The base station provides two independent services for rover operators:

- MoveIt 2 planning for Arm Position/IK mode.
- MediaMTX camera playback for Driver and Arm browsers.

It does not run the rover, ROSbridge, or the GUI. The rover and base-station
stacks can be started independently.

## Start

For local Windows development, enable Docker Desktop host networking in
`Settings > Resources > Network > Enable host networking` (Docker Desktop 4.34
or newer). Then start this stack and the mock-rover stack in either order:

```bash
docker compose -f docker-compose.local.yml up --build
```

For the production-shaped stack, configure the static LAN addresses:

```bash
copy .env.example .env
# Edit .env with the rover and base-station static LAN IPs.
docker compose -f docker-compose.yml up --build
```

## Guides

- [Arm MoveIt planning](docs/arm-moveit.md) — packages, Position/IK flow,
  orientation modes, demos, and current safety boundary.
- [Media gateway](docs/media-gateway.md) — rover RTSP input, browser playback,
  ports, and MediaMTX configuration.
- [Networking](docs/networking.md) — local mock setup, rover LAN setup, names,
  and Command-team configuration.

## Operator and rover connections

### Controls and arm planning

```mermaid
flowchart LR
    driver["Driver GUI"] <-->|"controls and telemetry\nrover.local :9090"| rover["Rover ROSbridge"]
    arm["Arm GUI"] <-->|"controls and telemetry\nrover.local :9090"| rover
    rover <-->|"arm planning and trajectories"| moveit["MoveIt + arm bridge\nBase-station PC"]
```

### Camera video

```mermaid
flowchart LR
    cameras["Rover cameras\nH.264 / RTSP"] -->|"RTSP :8554"| media["MediaMTX\nBase-station PC"]
    media -->|"WHEP :8889 + video UDP :8189"| driver["Driver GUI"]
    media -->|"WHEP :8889 + video UDP :8189"| arm["Arm GUI"]
```

The Driver and Arm GUIs connect directly to the rover for controls and
telemetry. MediaMTX provides camera playback, while MoveIt handles Arm
Position/IK planning.
