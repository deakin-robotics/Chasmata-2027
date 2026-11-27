# Shared ECAM alert snapshots

`ecam_alerts` provides complete ECAM source snapshots and Rover/BaseStation
aggregation. The ROS contract is `/ecam/alerts/source`,
`/ecam/alerts`, and `/rover/heartbeat` using the existing telemetry messages.

Rover and BaseStation subsystems report through `Reporter`, using a unique,
stable name for each reporter. Each side combines its reporters into one source
snapshot. For Rover:

```cpp
#include <ecam_alerts/reporter.hpp>

ecam_alerts::Reporter ecam(*this, "camera");
ecam.raise("CAMERA_FAULT");
ecam.clear("CAMERA_FAULT");
```

For BaseStation, pass `"basestation"` as the third constructor argument:

```cpp
ecam_alerts::Reporter ecam(*this, "heartbeat", "basestation");
ecam.raise("ROVER_HEARTBEAT_LOST");
ecam.clear("ROVER_HEARTBEAT_LOST");
```

Calls publish asynchronously while the node's ROS executor is running. Each
reporter periodically republishes its active codes so its owner can recover
them after a restart. Rover and BaseStation use separate reporter topics. Clearing a
code in one reporter does not clear it while another reporter still has it
active. Reporter names must be unique among running reporters on the same side.
The owner keeps the last state of a stopped reporter; a restarted reporter begins with an empty set.
Add new codes to the ECAM catalogue so the GUI can display them.

```bash
ros2 launch ecam_alerts ecam_alert_aggregator.launch.xml role:=rover
ros2 launch ecam_alerts ecam_alert_aggregator.launch.xml role:=basestation
```

Rover is authoritative while its heartbeat is present. After three seconds
without `/rover/heartbeat`, BaseStation combines snapshots and raises
`ROVER_HEARTBEAT_LOST`; once Rover returns, BaseStation paces replay of its
non-Rover sources and yields authority after Rover reflects them.
