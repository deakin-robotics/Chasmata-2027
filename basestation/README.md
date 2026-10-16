# BaseStation operations appliance

The BaseStation hosts the operations GUI and all BaseStation services: MoveIt,
BaseStation ROSbridge, ECAM aggregation, MediaMTX, camera health, and the web
proxy. Driver, Arm, and ECAM stations only need a browser.

## Start

For a production deployment, configure the static Rover and BaseStation values:

```bash
copy .env.example .env
# Set the Rover static IP and the BaseStation LAN IP in .env.
docker compose -f docker-compose.yml up --build
```

Operators then open:

```text
http://basestation.local/
http://basestation.local/driver
http://basestation.local/arm
http://basestation.local/ecam
```

If local name resolution is unavailable, use the documented fixed BaseStation
LAN IP in place of `basestation.local`.

## Architecture

```text
operator browser -> BaseStation operations web -> Rover ROSbridge
                                           -> BaseStation ROSbridge
                                           -> BaseStation MediaMTX
Rover cameras -> Rover MediaMTX -> BaseStation MediaMTX -> operator browser
```

The single **ROS Link** control opens the fixed Rover and BaseStation links.
operators do not configure endpoints. Rover controls, heartbeat, FMA, and
Manual arm operation remain on the Rover link. BaseStation services provide
MoveIt Position mode and shared ECAM state.

BaseStation MediaMTX is the sole browser-facing camera gateway. It pulls the
three Rover MediaMTX paths once, then serves operator WebRTC sessions locally.

See [networking](docs/networking.md) for LAN ports and configuration values.
