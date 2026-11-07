# Verification matrix

This is a tracked artifact, **not** an acceptance certificate.

| Requirement / reviewer item | Implemented evidence | Status / required next proof |
|---|---|---|
| Forrest: colcon build | Two ament packages, CMake + interface generation | Passed in the existing Jazzy development container for the single-adapter change; not hardware validation |
| Forrest: launch | `launch/diagnostics.launch.py` starts diagnostics-only node and accepts one serial configuration | Default-disabled launch and opt-in four-address probe passed with one simulated serial adapter |
| Forrest: README | `README.md` covers build, launch and limits | Delivered |
| Forrest: GUI message (address, speed, direction, result) | Read-only `WheelTelemetry` / `DrivetrainTelemetry`, separating commanded, measured and communication result; no motor-command interface | Logging-only intent confirmed by Forrest; topic name, rate and publisher **not signed off** by operator interface team |
| Wheel speed translated to motor speed and direction | `core::translateWheelSpeed` handles wheel rad/s, 50:1 configurable ratio, mirror direction | Unit tested; raw Modbus speed scaling/control words **UNVERIFIED** |
| 15 Hz drivetrain rate at 38,400 baud | 15 Hz parameter required, 38,400 baud required | Arithmetic only; worker schedule not yet implemented, bus timing not measured |
| Per-wheel telemetry (speed, faults) | `WheelTelemetry` message and raw telemetry methods; diagnostics node publishes probe results | No plugin publisher; actual speed 0x005F and fault register unverified |
| Wheels stop within the 300 ms target after commands stop | `core::validateTiming` checks two periods + upstream + stop wire budget <= explicit stop deadline | **NO** stop-ACK implementation/test; watchdog missing |
| No automatic re-arming after a stop or fault | Current plugin cannot activate | Deliberately fail-closed; no re-arming implemented |
| Worst-case bus utilization at most 50% | `core::validateTiming` refuses >50% worst-case bus utilization | Requires measured `worst_bus_cycle_ms` |
| Communication health counted per cycle: data invalid after two missed cycles, drive lost after three | Four-slave `beginCycle`/`endCycle`, per-slave cycle counters, `telemetryValid()`, mock tests | Implemented but **NOT connected to live worker**; four silent slaves alone do not prove adapter failure |
| A drive that misses an exchange is skipped for the rest of that cycle | Driver suppresses further exchanges for a slave after first wire transaction failure in its cycle; other three slaves remain reachable | Mock-tested on one shared context; live scheduler missing |
| Liveness heartbeat from a monotonic clock | Monotonic raw heartbeat updated before `read` and `write` | No external heartbeat sink; no hardware watchdog |
| No blocking Modbus I/O in the controller loop | Plugin no blocking Modbus read/write in ACTIVE path; example `is_async=true` | Actual worker callback dispatch in Jazzy **NOT tested** |
| No silent defaults for safety settings | Required safety params, one serial configuration, unique ID mapping and timing validation | Actual configuration/adapter bench validation pending |
| Drive faults detected and acted on | Fault reads return `UNSUPPORTED` | Fault register and response unresolved |
| Never change the drives' stored baud rate | No writes to baud register 0x00F6 | Code inspection pass; vendor provisioning required |
| Only verified stop commands are sent | No unsupported stop command issued | Bench coast/brake and stop command validation required |
| One owner per serial bus | Standalone diagnostic node owns serial port only when explicitly enabled; no mode arbitration | Must not run alongside production hardware instance |
| Testable without the rover | Provides hardware plugin shape and xacro template | Simulation stand-in not created; same controller config demonstration missing |
| Core logic independent of ROS and hardware | Pure core C++17 tests without ROS/hardware | Tested with g++ here |
| Actual speed read from a measurement register, never the setpoint | `readActualSpeedRaw(0x005F)` distinctly named, never converts to rad/s | Register address **UNVERIFIED**, must cross-check against the manual and bench-test |
| One USB-to-RS485 adapter for all four drives | One driver/context in hardware and diagnostics; YAML/xacro use one serial device and baud rate; unique IDs 1–4 | Mock verifies four-address traffic through one context; physical adapter test pending |
| Copilot: failed deactivation | On failure, leaves `active_` unchanged | Static inspection; controller_manager reaction unknown |
| Pluginlib discovery | plugin XML + CMake export | `check_drivetrain_plugin` discovered and loaded the plugin in the Jazzy development container |

## Single-adapter verification (7 November 2026)

- `colcon build --packages-up-to rover_drivetrain_control` passed with ROS 2 Jazzy, hardware_interface 4.48.0 and libmodbus 3.1.10.
- All four CTest tests passed: core logic, four-drive Modbus mock, single-bus hardware configuration and telemetry defaults.
- Xacro expansion from the example YAML produced one serial configuration and four unique slave IDs, with right-side mirroring preserved.
- A local integration check launched diagnostics with probing disabled, then enabled probing against one pseudo terminal emulating IDs 1–4. All four reads and their telemetry passed; invalid bus names, addresses and selectors produced no wire exchange. Only simulated hardware was used.
- Real shared-bus cycle time, all-four stop ACK time and motion readiness remain unverified. The existing lifecycle refusal remains in place.

## Runtime verification list (do not assume)

- [ ] Exact `SystemInterface::on_init()` API for installed Jazzy and exported state/command interface constructor behavior
- [ ] Export-after-failed-on_init behavior of installed controller_manager
- [ ] Controller manager reaction to hardware `read()` or `write()` returning `ERROR`
- [ ] Framework lifecycle state retained when `on_deactivate()` returns `ERROR`
- [ ] `pluginlib` resource discovery by `rover_drivetrain_control/RoverHardwareInterface`
- [ ] Jazzy `is_async` and `rw_rate` scheduler behavior, actual update/worker timing
- [ ] Confirm `pkg-config` and libmodbus ROS dependency keys via `rosdep`
- [ ] Wire-protocol: manual page + bench observation for every register
- [ ] Shared-bus transaction latency, 100,000-exchange loaded test, full four-drive cycle at 15 Hz / <=50% bus utilization; re-measure budgets after the single-adapter correction
- [ ] Fault mapping and message contract signed by Forrest and GUI team
- [ ] Independent physical enable-line watchdog agreed and tested
- [ ] Actual wheel/gearbox geometry, wheel-to-slave mapping, forward sign check
- [ ] 300 ms end-to-end last-valid-command -> four **acknowledged** stops including skipped cycle
- [ ] Before powered tests: verify E-stop, wheel off ground, current limit, power-cut watcher

**Stop criterion:** A successful `colcon build` and a plugin that loads do **not** establish motor readiness or the physical stop requirement.
