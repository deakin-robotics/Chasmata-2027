# Shared ECAM alert snapshots

`EcamAlertSource` is a small Python API for ROS 2 participants. Create it with
an existing node and one of `driver`, `ecam`, `arm`, `basestation`, or `rover`,
then call `raise_alert(code)` and `clear(code)`. It publishes the complete
active-code set on `/ecam/alerts/source` whenever that set changes. Its retained
snapshot is available to late-joining aggregators.

```python
from ecam_alerts.source import EcamAlertSource

self.ecam_alerts = EcamAlertSource(self, 'rover')
self.ecam_alerts.raise_alert('ARM_CAN_FAULT')
self.ecam_alerts.clear('ARM_CAN_FAULT')
```

Run the combined-state node on Rover as primary:

```sh
ros2 launch ecam_alerts ecam_alert_aggregator.launch.py role:=rover
```

Run it on BaseStation as standby/failover:

```sh
ros2 launch ecam_alerts ecam_alert_aggregator.launch.py role:=basestation
```

BaseStation listens to `/rover/heartbeat` and starts combining after three
seconds without a heartbeat. Once Rover returns, BaseStation republishes its
latest non-Rover source snapshots and waits for a Rover-authority combined
snapshot to reflect them before returning to relay-only operation.

Run snapshot and ROS aggregation tests in the package workspace with:

```sh
python3 -m unittest discover -s test -v
```
