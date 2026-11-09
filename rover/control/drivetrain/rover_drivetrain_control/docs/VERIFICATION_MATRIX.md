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
| Per-wheel telemetry (speed, faults) | `WheelTelemetry` message and raw telemetry methods; diagnostics node publishes probe results | No plugin publisher; actual speed 0x005F and fault code 0x0076 manual-cited, bench check pending |
| Wheels stop within the 300 ms target after commands stop | `core::validateTiming` checks two periods + upstream + stop wire budget <= explicit stop deadline. Bench mode only: broadcast stop, then every drive must report status 0 ("stop accepted", not proof the motor has run down; see the README bench test step), mock-tested | Production: **NO** stop-ACK implementation; watchdog missing. Bench mode uses its own `bench_stop_deadline_ms` (about 1.3 s at 2 Hz), **not** the 300 ms target |
| No automatic re-arming after a stop or fault | Production plugin cannot activate. Bench mode latches every fault, unconfirmed-fault, lost-speed-feedback, loss, failed-direction-write or late-trigger stop until the next successful activation | Production deliberately fail-closed. Bench latch mock-tested only |
| Worst-case bus utilization at most 50% | `core::validateTiming` refuses >50% worst-case bus utilization | Requires measured `worst_bus_cycle_ms` |
| Communication health counted per cycle: data invalid after two missed cycles, drive lost after three | Four-slave `beginCycle`/`endCycle`, per-slave cycle counters, `telemetryValid()`, mock tests | Implemented but **NOT connected to live worker**; four silent slaves alone do not prove adapter failure |
| A drive that misses an exchange is skipped for the rest of that cycle | Driver suppresses further exchanges for a slave after first wire transaction failure in its cycle; other three slaves remain reachable | Mock-tested on one shared context; live scheduler missing |
| Liveness heartbeat from a monotonic clock | Monotonic raw heartbeat updated before `read` and `write` | No external heartbeat sink; no hardware watchdog |
| No blocking Modbus I/O in the controller loop | Production: no Modbus I/O in the ACTIVE path. Bench mode **does** block in `read()`/`write()` (up to ~250 ms a cycle, longer during a stop) and relies on `is_async=true` to keep that off the controller-manager loop | Actual worker callback dispatch in Jazzy **NOT tested** |
| No silent defaults for safety settings | Required safety params, one serial configuration, unique ID mapping and timing validation | Actual configuration/adapter bench validation pending |
| Drive faults detected and acted on | `readFaultRaw()` reads fault code 0x0076 raw (function code 03); diagnostics probe selector 6. Bench mode: configure refuses a non-zero fault; `read()` stops all four on one, and also when a drive's fault code cannot be confirmed (2 failed polls in a row or no good read for 2.5 poll intervals), tracked apart from cycle health so good speed reads cannot hide it. Actual speed `0x005F` gets the same freshness rule ("speed feedback lost"), and the exported velocity is never NaN while active (0 after activation, then the last good reading), because diff_drive_controller skips writing wheel commands, including its cmd_vel-timeout zero, on NaN feedback | Fault register manual-cited, bench check pending. Production has no fault response; the bench response is mock-tested only |
| Never change the drives' stored baud rate | No writes to baud register 0x00F6, address 0x00A6 or save register 0x80FF; the driver refuses all three, and a mock test checks no write ever reaches them | Code inspection and mock pass; vendor provisioning required |
| Only verified stop commands are sent | Production issues no stop command. Bench mode sends 0x0066=0 (per drive and as a broadcast) and checks that each drive's running status reads 0 (stop accepted). A stop that is skipped or fails on one drive becomes a broadcast to all four | Bench coast/brake and broadcast stop validation required on real drives |
| One owner per serial bus | Standalone diagnostic node owns serial port only when explicitly enabled; no mode arbitration | Must not run alongside production hardware instance |
| Testable without the rover | Provides hardware plugin shape and xacro template | Simulation stand-in not created; same controller config demonstration missing |
| Bench motion mode (opt-in, `bench_motion_enabled`) | Off by default. Configure checks IDs and faults; activate sets internal mode and pole pairs (not saved) with read-back; 2 Hz at 9600 baud with alternating reads; stops on fault, loss, a failed direction write, late trigger, deactivate, error and shutdown. `test_bench_motion` runs the real plugin against four mocked drives | **Mock only, never run on hardware.** Needs Forrest's approval and a held power cutoff before use; bus timing, drive turnaround and stop behaviour to be measured on the bench |
| Core logic independent of ROS and hardware | Pure core C++17 tests without ROS/hardware | Tested with g++ here |
| Actual speed read from a measurement register, never the setpoint | `readActualSpeedRaw(0x005F)` distinctly named, never converts to rad/s; diagnostics probe selector 8 | Actual speed register manual-cited, bench check pending |
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
- [ ] Wire-protocol: bench observation for every register (manual pages now cited in [`BLD305S_REGISTERS.md`](BLD305S_REGISTERS.md))
- [ ] Shared-bus transaction latency, 100,000-exchange loaded test, full four-drive cycle at 15 Hz / <=50% bus utilization; re-measure budgets after the single-adapter correction
- [ ] Fault mapping and message contract signed by Forrest and GUI team
- [ ] Independent physical enable-line watchdog agreed and tested
- [ ] Actual wheel/gearbox geometry, wheel-to-slave mapping, forward sign check
- [ ] 300 ms end-to-end last-valid-command -> four **acknowledged** stops including skipped cycle
- [ ] Before powered tests: verify E-stop, wheel off ground, current limit, power-cut watcher

**Stop criterion:** A successful `colcon build` and a plugin that loads do **not** establish motor readiness or the physical stop requirement.
