# Shared ECAM alert snapshots

`ecam_alerts` provides complete ECAM source snapshots and Rover/BaseStation
aggregation. The ROS contract is `/ecam/alerts/source`,
`/ecam/alerts`, and `/rover/heartbeat` using the existing telemetry messages.

`EcamAlertSource` publishes a retained complete source snapshot whenever its
alerts change. For example, BaseStation owns its own source:

```cpp
#include <ecam_alerts/source.hpp>

ecam_alerts::EcamAlertSource alerts(*this, "basestation");
alerts.raise_alert("ROVER_HEARTBEAT_LOST");
alerts.clear("ROVER_HEARTBEAT_LOST");
```

Allowed source names are `driver`, `ecam`, `arm`, `basestation`, and `rover`.
Codes are trimmed, deduplicated, and published in lexical order with reliable,
transient-local QoS.

Rover subsystems can report through `Reporter`, using a unique, stable name
for each reporter. Rover's `RoverAlertOwner` combines their active codes into
one Rover source snapshot. Subsystems should use this client instead of
publishing their own `rover` source snapshot:

```cpp
#include <ecam_alerts/reporter.hpp>

ecam_alerts::Reporter ecam(*this, "camera");
ecam.raise("CAMERA_FAULT");
ecam.clear("CAMERA_FAULT");
```

Calls publish asynchronously while the node's ROS executor is running. Each reporter periodically republishes its own
active codes so the Rover owner can recover them after a restart. Clearing a
code in one reporter does not clear it while another reporter still has it
active. Reporter names must be unique among running reporters. Rover keeps the
last state of a stopped reporter; a restarted reporter begins with an empty set.
Add new codes to the ECAM catalogue so the GUI can display them.

```bash
ros2 launch ecam_alerts ecam_alert_aggregator.launch.xml role:=rover
ros2 launch ecam_alerts ecam_alert_aggregator.launch.xml role:=basestation
```

Rover is authoritative while its heartbeat is present. After three seconds
without `/rover/heartbeat`, BaseStation combines snapshots and raises
`ROVER_HEARTBEAT_LOST`; once Rover returns, BaseStation paces replay of its
non-Rover sources and yields authority after Rover reflects them.
