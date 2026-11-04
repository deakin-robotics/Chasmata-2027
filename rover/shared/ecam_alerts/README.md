# Shared ECAM alert snapshots

`ecam_alerts` is a C++17 ROS 2 package for complete ECAM source snapshots and
Rover/BaseStation aggregation. The ROS contract remains `/ecam/alerts/source`,
`/ecam/alerts`, and `/rover/heartbeat` using the existing telemetry messages.

Use `EcamAlertSource` from a C++ node to publish a retained complete source
snapshot whenever its alerts change:

```cpp
#include <ecam_alerts/source.hpp>

ecam_alerts::EcamAlertSource alerts(*this, "rover");
alerts.raise_alert("ARM_CAN_FAULT");
alerts.clear("ARM_CAN_FAULT");
```

Allowed source names are `driver`, `ecam`, `arm`, `basestation`, and `rover`.
Codes are trimmed, deduplicated, and published in lexical order with reliable,
transient-local QoS.

```bash
ros2 launch ecam_alerts ecam_alert_aggregator.launch.xml role:=rover
ros2 launch ecam_alerts ecam_alert_aggregator.launch.xml role:=basestation
```

Rover is authoritative while its heartbeat is present. After three seconds
without `/rover/heartbeat`, BaseStation combines snapshots and raises
`ROVER_HEARTBEAT_LOST`; once Rover returns, BaseStation paces replay of its
non-Rover sources and yields authority after Rover reflects them.
