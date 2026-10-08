# Networking

## Real rover network at a glance

The rover, base station, Driver PC, and Arm operator PC connect to the same
private LAN, which can be a switch or the rover radio network. Internet access
is not required.

### ROS controls and arm planning

```mermaid
flowchart LR
    subgraph lan["Rover LAN"]
        subgraph roverPC["Rover PC"]
            ros["Rover ROS 2 nodes"]
            bridge["ROSbridge :9090"]
            discovery["Fast DDS discovery :11811/UDP"]
        end

        subgraph basePC["Base-station PC"]
            moveit["MoveIt 2\n(host network)"]
        end

        subgraph driverPC["Driver PC"]
            driver["Driver GUI in browser"]
        end

        subgraph armPC["Arm operator PC"]
            arm["Arm GUI in browser"]
        end

        driver <-->|"controls and telemetry\nWebSocket :9090"| bridge
        arm <-->|"Arm manual mode and telemetry\nWebSocket :9090"| bridge
        moveit <-->|"ROS 2 discovery via :11811\nthen topics and actions"| ros
        arm -->|"Position target\n/arm/target_pose"| moveit
    end

```

The Driver and Arm GUIs connect to the rover for controls and telemetry.
MoveIt exchanges planning and trajectory data with the rover over ROS 2.

### Camera video

```mermaid
flowchart LR
    subgraph lan["Rover LAN"]
        subgraph roverPC["Rover PC"]
            cameras["Camera sources"]
        end

        subgraph basePC["Base-station PC"]
            media["MediaMTX\n(Docker, published ports)"]
        end

        subgraph driverPC["Driver PC"]
            driver["Driver GUI in browser"]
        end

        subgraph armPC["Arm operator PC"]
            arm["Arm GUI in browser"]
        end

        cameras -->|"RTSP :8554"| media
        media <-->|"WHEP :8889\nWebRTC video UDP :8189"| driver
        media <-->|"WHEP :8889\nWebRTC video UDP :8189"| arm
    end
```

Camera video goes from the rover to MediaMTX, then from MediaMTX to the
operator browsers. It does not pass through MoveIt.

## Local mock setup

On Windows, enable Docker Desktop host networking in
`Settings > Resources > Network > Enable host networking` (Docker Desktop 4.34
or newer). Start the mock rover and base-station stacks in either order:

```bash
cd test/mock_rover
docker compose up --build
```

Then start the local base station:

```bash
cd basestation
docker compose -f docker-compose.local.yml up --build
```

The mock rover runs ROSbridge at `ws://localhost:9090` and the Fast DDS
discovery server on UDP `11811`. Its ROS services and local MoveIt use host
networking and connect through `127.0.0.1:11811`; they do not need a shared
Docker network. MediaMTX publishes its camera ports to Windows for the GUI.

## Real rover LAN

On the base-station PC, copy `.env.example` to `.env`, set the static IP
values, and start the normal stack:

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
configuration. The Driver GUI and Arm GUI use the same names.

## Responsibility boundary

Command owns the real network setup: static rover and base-station IPs, name
resolution for `rover.local` and `basestation.local`, and firewall/radio rules
for ROS discovery, RTSP `8554`, WHEP `8889`, and WebRTC UDP `8189`.

This repository supplies the service configuration that consumes those values.
It does not assign IPs, create DNS records, or configure the radio network.
