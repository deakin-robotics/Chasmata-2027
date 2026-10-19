# Verification matrix — v0.4 design alignment

Source: *DCR Rover System Design Document 0.4* (12 Oct 2026), sections 4, 7–9. This is a tracked artifact, **not** an acceptance certificate.

| ID / reviewer item | Implemented evidence | Status / required next proof |
|---|---|---|
| OI-16 Forrest: colcon build | Two ament packages, CMake + interface generation | **NOT VERIFIED HERE**; run `colcon build --packages-up-to rover_drivetrain_control` on actual Jazzy |
| Forrest: launch | `launch/diagnostics.launch.py` starts diagnostics-only node | Code reviewed / Python syntax checked; runtime ROS test required |
| Forrest: README | `README.md` covers build, launch and limits | Delivered |
| Forrest: GUI message (address, speed, direction, result) | Read-only `WheelTelemetry` / `DrivetrainTelemetry`, separating commanded, measured and communication result; no motor-command interface | Logging-only intent confirmed by Forrest; topic name, rate and publisher **not signed off** by operator interface team (OI-04) |
| SR-01 / SR-02 | `core::translateWheelSpeed` handles wheel rad/s, 50:1 configurable ratio, mirror direction | Unit tested; raw Modbus speed scaling/control words **UNVERIFIED** |
| SR-03 / AD-07 | 15 Hz parameter required, 38,400 baud required | Arithmetic only; worker schedule not yet implemented, bus timing not measured |
| SR-04/05 | `WheelTelemetry` message and raw telemetry methods; diagnostics node publishes probe results | No plugin publisher; actual speed 0x005F and fault register unverified |
| SR-06 / AD-22 | `core::validateTiming` checks two periods + upstream + stop wire budget <= explicit stop deadline | **NO** stop-ACK implementation/test; watchdog missing |
| SR-07 | Current plugin cannot activate | Deliberately fail-closed; no re-arming implemented |
| SR-08 / AD-07 | `core::validateTiming` refuses >50% worst-case bus utilization | Requires measured `worst_bus_cycle_ms` |
| SR-09 / AD-15 | `beginCycle`/`endCycle`, per-slave cycle counters, `telemetryValid()`, mock tests | Implemented but **NOT connected to live worker**; true bus failure vs two silent slaves unresolved |
| SR-10 / AD-14 | Driver suppresses further exchanges for a slave after first wire transaction failure in its cycle | Mock-tested; no live 6–8-exchange scheduler |
| SR-11 / AD-04 | Monotonic raw heartbeat updated before `read` and `write` | No external heartbeat sink; no hardware watchdog |
| SR-12 / AD-05 | Plugin no blocking Modbus read/write in ACTIVE path; example `is_async=true` | Actual worker callback dispatch in Jazzy **NOT tested** |
| SR-13 / AD-12 | Required safety params, serial bus uniqueness, ID mapping and timing validation | Actual configuration/adapter bench validation pending |
| SR-14 / AD-17 | Fault reads return `UNSUPPORTED` | Fault register and response unresolved |
| SR-15 / AD-08 | No writes to baud register 0x00F6 | Code inspection pass; vendor provisioning required |
| SR-16 / AD-13 | No unsupported stop command issued | Bench coast/brake and stop command validation required |
| SR-17 | Standalone diagnostic node owns serial port only when explicitly enabled; no mode arbitration | Must not run alongside production hardware instance |
| SR-18 | Provides hardware plugin shape and xacro template | Simulation stand-in not created; same controller config demonstration missing |
| SR-19 / AD-11 | Pure core C++17 tests without ROS/hardware | Tested with g++ here |
| OI-17 / AD-23 | `readActualSpeedRaw(0x005F)` distinctly named, never converts to rad/s | Register address **UNVERIFIED**, must cross-check and bench-test |
| Copilot: duplicate bus ports | Rejects identical left/right devices | Static inspection; different aliases to same port not yet resolved |
| Copilot: failed deactivation | On failure, leaves `active_` unchanged | Static inspection; controller_manager reaction unknown |
| Pluginlib discovery | plugin XML + CMake export | Jazzy discovery test required, not proved by compiler |

## Runtime verification list (do not assume)

- [ ] Exact `SystemInterface::on_init()` API for installed Jazzy and exported state/command interface constructor behavior
- [ ] Export-after-failed-on_init behavior of installed controller_manager
- [ ] Controller manager reaction to hardware `read()` or `write()` returning `ERROR`
- [ ] Framework lifecycle state retained when `on_deactivate()` returns `ERROR`
- [ ] `pluginlib` resource discovery by `rover_drivetrain_control/RoverHardwareInterface`
- [ ] Jazzy `is_async` and `rw_rate` scheduler behavior, actual update/worker timing
- [ ] Confirm `pkg-config` and libmodbus ROS dependency keys via `rosdep`
- [ ] Wire-protocol: manual page + bench observation for every register (AD-23)
- [ ] One bus transaction latency, 100,000-exchange loaded test, 15 Hz / <=50% bus utilization
- [ ] Fault mapping and message contract signed by Forrest and GUI team
- [ ] Independent physical enable-line watchdog agreed and tested (OI-01)
- [ ] Actual wheel/gearbox geometry, wheel-to-slave mapping, forward sign check
- [ ] 250 ms end-to-end last-valid-command -> four **acknowledged** stops including skipped cycle
- [ ] Before powered tests: verify E-stop, wheel off ground, current limit, power-cut watcher (AD-21)

**Stop criterion:** A successful `colcon build` and a plugin that loads do **not** establish motor readiness or the physical stop requirement.
