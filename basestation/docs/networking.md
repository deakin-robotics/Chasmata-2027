# Networking

## Local mock setup

Start the mock rover first:

```bash
cd test/mock_rover
docker compose up --build
```

Then start the local base station:

```bash
cd basestation
docker compose -f docker-compose.local.yml up --build
```

The local mock provides ROSbridge at `ws://localhost:9090`, Fast DDS discovery
inside the shared Docker test network, and synthetic camera publishers. The
local base-station override joins that Docker network for MoveIt and publishes
MediaMTX ports to Windows for the GUI.

## Real rover LAN

On the base-station PC, enable Docker Desktop host networking, copy
`.env.example` to `.env`, set the static IP values, and start the normal stack:

```bash
copy .env.example .env
docker compose -f docker-compose.yml up --build
```

| Variable | What it tells | Example |
| --- | --- | --- |
| `ROVER_DISCOVERY_SERVER` | MoveIt where to find the rover's ROS discovery service. | `192.168.1.20:11811` |
| `MEDIA_WEBRTC_ADDITIONAL_HOSTS` | MediaMTX which real base-station LAN IP to give camera viewers. | `192.168.1.10` |
| `MEDIA_WEBRTC_ALLOW_ORIGINS` | Which browser page origins may request WHEP playback. | `http://localhost:4200` |

The first value is for the base station to find the rover. The second is for
MediaMTX to tell a browser where to send and receive UDP camera video. Neither
value configures the Driver or Arm GUI's direct ROS connection.

## Names used by GUIs

Operator PCs use names instead of numeric addresses:

| Name | Used for |
| --- | --- |
| `rover.local` | ROSbridge and rover controls/telemetry, such as `rover.local:9090`. |
| `basestation.local` | Camera gateway, such as `http://basestation.local:8889`. |

Windows resolves these names through the rover network's DNS or hosts-file
configuration. The Driver GUI and Arm GUI use the same names, even when they
run on separate PCs.

## Responsibility boundary

Command owns the real network setup: static rover and base-station IPs, name
resolution for `rover.local` and `basestation.local`, and firewall/radio rules
for ROS discovery, RTSP `8554`, WHEP `8889`, and WebRTC UDP `8189`.

This repository supplies the service configuration that consumes those values.
It does not assign IPs, create DNS records, or configure the radio network.
