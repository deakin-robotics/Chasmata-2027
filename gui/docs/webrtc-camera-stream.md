# Camera streams

The GUI displays Front, Gimbal, and Arm feeds through the BaseStation-hosted
`/media/<camera>/whep` route. Rover camera publishers send the three WHIP
streams directly to BaseStation MediaMTX, which fans out browser WebRTC
sessions.

```mermaid
flowchart TB
    subgraph rover[Rover]
        cameras[Front, Gimbal and Arm cameras]
        publisher[GStreamer camera publisher]
        cameras --> publisher
    end

    subgraph basestation[Base station]
        media[MediaMTX]
    end

    driver[Driver GUI in browser]
    arm[Arm GUI in browser]

    publisher -->|WHIP signalling TCP 8889<br/>WebRTC media UDP 8189| media
    media -->|WHEP signalling via /media, TCP 80<br/>WebRTC media, UDP 8189| driver
    media -->|WHEP signalling via /media, TCP 80<br/>WebRTC media, UDP 8189| arm
```

Local Angular development continues to use the BaseStation MediaMTX address in
`src/environments/environment.ts`. Production derives the BaseStation origin
from the loaded operations website.
