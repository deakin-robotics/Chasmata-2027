## Current control paths

```text
Manual GUI: /arm/joy
  -> missing production manual-command and mode adapter
  -> /arm/direct_drive
  -> ArmHardwareInterface -> /socketcan_bridge/tx -> SocketCAN -> motor

Position GUI: /arm/target_pose + /arm/orientation_lock
  -> base-station arm_moveit_bridge -> MoveIt
  -> /arm_controller/follow_joint_trajectory
  -> joint_trajectory_controller -> ArmHardwareInterface -> CAN -> motor

Motor feedback: CAN -> /socketcan_bridge/rx -> ArmHardwareInterface
  -> /arm/joint_states, /motor_stat_1, /motor_stat_2, /arm/control/status
```

The MoveIt trajectory path exists in code. The mock rover accepts `/arm/joy`
and `/fma/arm/request`, but those mock consumers do not translate commands into
real motor commands. The real driver accepts per-joint `DirectDrive` messages
instead. Its direct mode bypasses planning; it does not bypass the driver's
soft limits or E-stop checks and is not the FMA's `DIRECT` protection law.

## Preparation needed for the supplied test plan

These are review findings and proposed work, not additional workbook requirements.

| Priority | Preparation | Evidence and present behaviour | Acceptance before claiming the relevant stage passed |
| --- | --- | --- | --- |
| Before stage 1 | Identify the actual adapter and protocol. | The workbook specifies PEAK; the plan says the club CAN-to-USB board. The bridge uses Linux SocketCAN, not an arbitrary serial USB protocol. The arm launch does not start the bridge or configure bitrate. The hardware plugin's `can_interface` string is only read/logged; the bridge's `interface` parameter selects the actual device. See E1, E3 and E4. | Record adapter model, USB/driver identity, SocketCAN interface, bitrate, termination and wiring. If the club board is not SocketCAN-compatible, prepare a transport adapter. Capture real TX/RX before sending motion commands. |
| Before stages 2 and 3 | Provide an explicit one-motor launch/URDF/controller configuration. | The supplied launch always loads six joints. `all_motor_status_safe()` requires fresh fault-free status from every configured joint; `write()` also clears direct commands if any joint encoder becomes stale. A single connected motor cannot satisfy this setup. See E1 and E3. | Configure only the secured motor, with its real CAN ID, calibrated limits and conservative velocity. Retain freshness and fault gates. Do not spoof the other five motors or weaken the production checks. The one-joint controller must use the same joint list. Full MoveIt testing needs the full model and is a later test. |
| Before stage 2 | Confirm the real motor enable, disable and fault-reset sequence; expose the needed guarded controls. | `Motor` encodes speed, position, set-home and a broadcast `clr_faults()` frame. The fault-clear helper has no caller in the real stack; no explicit controller enable/disable API is exposed. Activation sends zero speed, not a verified torque-disable sequence. `/arm/set_home` rebases coordinates and is not a fault reset. See E1 and E2. | Verify commands against the actual controller documentation and capture its replies. Provide a deliberate, interlocked enable/disable/reset interface where the protocol requires one; check that reset leaves motion inhibited. Document any equivalent hardware procedure instead of claiming that a zero-speed command disables the controller. |
| Before stage 2 | Confirm units, scaling, direction, zero reference and controller-side limits. | Speed is encoded as RPM x 100 and position as degrees x 16384 / 360. The driver converts joint radians directly to this encoding; there is no configurable gear ratio, direction sign or encoder offset in that path. Direct speed respects URDF velocity limits, but position CAN commands carry no speed/current cap. All supplied joint velocity limits are 1 rad/s. See E1, E2 and E3. | Confirm whether protocol units refer to motor or joint output. Measure positive/negative motion and encoder readings; configure conversion if needed. Set the plan's conservative speed/current/travel limits in the real controller and test small bounded moves. Base/roll startup angles can be ambiguous without a turn reference; record a valid commissioning reference. |
| Before motion tests and stage 5 | Add command freshness/deadman supervision and a reachable stop for transport/process failure. | The 250 ms driver timeout checks encoder and motor-status freshness, not the age of operator commands. Direct speed stays latched while CAN feedback continues. `/estop=false` also has no freshness lease. On a broken CAN link the driver can request zero speed but cannot deliver it; process loss prevents software stopping entirely. See E1 and E4. | With feedback still healthy, stop operator input, kill its publisher, lose ROS/radio, stop the driver, and disconnect CAN in separate controlled tests. Verify actual motion stops within the agreed measured budget, not merely that a zero CAN frame was requested. Use a controller-side communications watchdog where supported and the plan's independent power disconnect. The source's 250 ms target is provisional and needs a complete detection/transmission/deceleration budget. |
| Before stage 4 | Connect manual GUI input, mode handshake and arm/drive interlocks to the real stack. | GUI publishes `/arm/joy` and mode requests; the real arm driver consumes neither. No production adapter was found in the reviewed checkout. GUI-local gating does not enforce rover-side exclusion. The GUI's button-10 clear-fault command also stops at this missing boundary. See E5 and E6. | Implement the agreed mapping into direct commands, neutral/release to zero, source ownership, manual/trajectory handover and mode acknowledgements based on real readiness. Prevent simultaneous drive and arm authority. Test disconnect and cancellation without old targets resuming. |
| Before stages 4 and 5 | Connect real safety, fault and validity data to GUI/FMA/ECAM. | The driver already publishes `/arm/control/status`; it must be consumed rather than recreated as mock readiness. GUI's telemetry bridge consumes `/arm/joint_states` and `/fma/state`, not raw motor status or `ArmControlStatus`. Raw motor messages lack timestamps and explicit validity fields. The CAN bridge already publishes diagnostics. See E1, E4, E7 and E8. | Translate real arm readiness, faults, stale feedback, CAN diagnostics and protection state into the agreed GUI contracts. Supply real rover availability for GUI publishing gates. Verify unavailable/stale states and stop reasons in ROS and GUI. Publish an inactive status during lifecycle teardown so the transient-local status cannot remain apparently active. An ECAM aggregator already exists; it needs an arm fault source, not another aggregator. |
| Before fault recovery tests | Agree the arm fault action and recovery table. | All nonzero status-2 fault bytes inhibit controller motion and clear direct modes. The affected joint gets zero speed; other healthy joints can receive bounded position-hold commands. This is not a confirmed all-joint torque disable or the workbook's severity classification. See E1 and E2. | Specify response per fault, whether other joints hold or stop, when reset is allowed, and how a fresh command re-arms. Exercise each supported fault class and verify GUI indication and physical result. |
| Before wider trajectory tests | Verify planning limits, collisions and command handover on real feedback. | The six joint names and position/velocity limits match across rover, MoveIt and GUI. All three checked-in URDFs have no collision elements. Direct mode release can resume the controller's current target. See E3, E9 and E10. | Test bounded trajectories, partial goals, cancellation and handover. Add collision geometry/checking before claiming collision avoidance; it is not required to prove a single secured motor's CAN response. Verify that position mode cannot exceed the selected bench velocity/current limits. |
| Before end-effector extension | Confirm the EE hardware boundary and its own stop/telemetry contract. | A separate node sends ID 0x07 commands and observes `/estop`, but has no feedback subscription, command timeout or controller health verification. The workbook describes I2C at the EE boundary and leaves the camera protocol TBD. See E11. | Confirm whether CAN 0x07 is an upstream PCB that owns downstream I2C, rather than assuming that topology. Define actuator functions and feedback, implement/test EE timeout and stopping, and keep the EE disconnected from the initial arm-motor test unless explicitly included. |

### Staged readiness

| Plan stage | Review assessment | Evidence required to close |
| --- | --- | --- |
| 1 CAN adapter | Ready to prepare; physical compatibility unverified. | Adapter identification, bitrate/wiring record and real bidirectional capture. |
| 2 Direct driver and motor | Blocked by the default six-joint configuration and unverified enable/disable/reset and limit setup. | One-joint configuration; documented protocol; bounded two-direction movement, normal stop and real status. |
| 3 ROS to Control | DirectDrive and trajectory interfaces exist; real CAN behaviour remains unverified. | Timestamped ROS commands, CAN capture and returned real telemetry. A one-joint direct test does not validate six-joint MoveIt execution. |
| 4 GUI to motor | Blocked for manual held-input operation by missing production Joy/mode integration. | Real mode confirmation, motion only with authority, neutral/release stop and live displayed state. Test the planned-motion path separately. |
| 5 Stops and faults | Some protections implemented; command-loss and failed-transport stopping remain unresolved. | Separate timed tests for command silence, ROS loss, CAN loss, driver loss, E-stop, faults and deliberate recovery. Record physical stop time and resulting ROS/GUI states. |

Use the plan's secured motor, low limits, power disconnect and three-person
roles for physical testing. The record should include the software commit,
adapter/controller identities, firmware and limits, exact commands and replies,
direction convention, ROS/CAN captures, observed stopping times, GUI evidence,
faults and recovery steps. No readiness entry here is a substitute for that record.

## Source evidence

| Ref | Repository evidence | Relevant behaviour |
| --- | --- | --- |
| E1 | [Arm hardware interface](../rover_ws/src/dcr_arm_driver/src/arm_hardware_interface.cpp) | Lifecycle, direct commands, trajectory re-arm, soft limits, freshness, E-stop, homing, real status publication. |
| E2 | [Motor encoding and parsing](../rover_ws/src/dcr_arm_driver/src/motor.cpp) | CAN command bytes and scaling, raw telemetry decoding, unused fault-clear helper. |
| E3 | [Arm launch](../rover_ws/src/dcr_arm_driver/config/arm_control.launch.py), [controller configuration](../rover_ws/src/dcr_arm_driver/config/arm_controllers.yaml), [rover URDF](../rover_ws/src/dcr_arm_driver/urdf/robot_arm.urdf) | Six-joint default, 50 Hz loop, joint limits and CAN IDs. |
| E4 | [SocketCAN transport](../rover_ws/src/nobleo_socketcan_bridge/src/socketcan_bridge.cpp), [bridge node and diagnostics](../rover_ws/src/nobleo_socketcan_bridge/src/socketcan_bridge_node.cpp) | Actual Linux CAN interface, bridge parameters, errors and diagnostics. |
| E5 | [GUI arm command publisher](../../../../gui/src/app/core/control/arm/arm-command-publisher.ts) | Joy transport, neutral command and button-10 fault-clear request. |
| E6 | [Mock command subscriptions](../../../mock_rover/src/rover/mock_rover_node.cpp), [mock arm behaviour](../../../mock_rover/src/arm/arm_control.cpp), [mock mode handling](../../../mock_rover/src/rover/fma_control.cpp) | Existing simulated Joy and mode consumers; not a production hardware adapter. |
| E7 | [ArmControlStatus message](../../../../interfaces/telemetry_interfaces/msg/ArmControlStatus.msg), [GUI telemetry bridge](../../../../gui/src/app/core/ros/ros-telemetry-bridge.ts), [GUI heartbeat monitor](../../../../gui/src/app/core/ros/ros-heartbeat-monitor.ts) | Readiness fields, GUI state subscriptions and availability gating. |
| E8 | [Telemetry requirements](../../../../gui/docs/telemetry-requirements.md), [ECAM aggregator](../../../shared/ecam_alerts/src/aggregator.cpp) | Required validity, rates, FMA/alert semantics and existing alert aggregation. |
| E9 | [MoveIt bridge](../../../../basestation/arm_moveit_bridge/src/arm_moveit_bridge.cpp), [MoveIt documentation](../../../../basestation/docs/arm-moveit.md) | Pose planning, orientation lock, action execution/cancellation and status. |
| E10 | [MoveIt URDF](../../../../basestation/arm_moveit_config/config/arm.urdf), [GUI URDF](../../../../gui/public/assets/kinematics/arm.urdf), [configuration tests](../../../../basestation/test/test_arm_configuration.py) | Joint/limit compatibility and present geometry boundary. |
| E11 | [EE driver](../rover_ws/src/dcr_ee_driver/src/ee_driver_node.cpp), [EE parameters](../rover_ws/src/dcr_ee_driver/config/ee_params.yaml) | Separate CAN ID 0x07 command node, E-stop and shutdown stop. |
| E12 | [Driver tests](../rover_ws/src/dcr_arm_driver/test/test_direct_drive.cpp), [build definition](../rover_ws/src/dcr_arm_driver/CMakeLists.txt) | Existing synthetic-feedback tests for persistence, invalid inputs, limits, stale feedback, E-stop and reactivation. |

## Verification performed for this review

- `python -B -m unittest discover -s basestation/test -p test_arm_configuration.py -v`:
  **2 tests passed**. These cover GUI/MoveIt limits and planning groups.
- Parsed rover, MoveIt and GUI URDFs and compared all six joint names and
  lower/upper/velocity limits: **matched**. Each contains **0 collision elements**.
- Inspected C++ driver test coverage and ROS topic consumers. Native ROS 2
  `colcon` and Docker were not available on this host's command path, so the
  C++/ROS suites, plugin loading and runtime CAN behaviour were **not executed**.
- Extracted the complete supplied test-plan body and workbook worksheet data
  for requirements review. Source documents were not modified.

## Requirements matrix

The entries below preserve source IDs, requirement wording, verification and
acceptance criteria. Source metadata remains separate from the review assessment.
`Partial` means relevant code exists but the source requirement is not fully
demonstrated. `Pending hardware` does not mean a physical test passed. `Gap`
identifies missing implementation, a contract decision or missing evidence.

### Arm and end effector

#### ARM-001

**Source requirement:** All six arm motors shall communicate on one CAN bus through the PEAK CAN adapter.

| Source field | Value |
| --- | --- |
| Source | Control!A7:N7 |
| Parent / source | Interview Q04 / existing RTM CTRL-004 |
| Subsystem / type | Robotic arm / Interface |
| Priority / owner | P0 / Control / Manipulation |
| Source status / provisional | Open / No |
| Rationale / objective | Provide a common arm motor communications path. |
| Verification method | CAN bench test with all six motors |
| Acceptance / source evidence | CAN bus topology, bitrate, termination, node IDs and message definitions documented and tested. |
| Dependencies | PEAK adapter; installed drivers; USB allocation |
| Source notes / open actions | Six arm motors use addresses 0x01–0x06. |

**Review assessment:** Partial; pending hardware. **Plan stage:** 1, then six-motor expansion.

E1-E4 implement a common CAN path with configured IDs 0x01-0x06. Confirm PEAK versus club adapter, wiring, bitrate and each real ID. A one-motor pass cannot close the six-motor requirement.

#### ARM-002

**Source requirement:** The end-effector PCB shall use CAN address 0x07 if it is connected to the arm CAN network.

| Source field | Value |
| --- | --- |
| Source | Control!A8:N8 |
| Parent / source | Interview Q03 |
| Subsystem / type | Robotic arm / End effector / Interface |
| Priority / owner | P0 / Control / Manipulation |
| Source status / provisional | Open / No |
| Rationale / objective | Provide a stable identity for the end-effector controller. |
| Verification method | CAN integration test |
| Acceptance / source evidence | End-effector PCB responds only at documented address 0x07 and does not conflict with arm motors. |
| Dependencies | CAN bus design; end-effector PCB |
| Source notes / open actions | Questionnaire states end-effector PCB address 0x07. |

**Review assessment:** Partial; pending hardware. **Plan stage:** Later EE integration.

E11 defaults to CAN ID 0x07. Prove the PCB responds at that ID without conflicts; reconcile the conditional CAN connection with EE-002 before assuming a final topology.

#### ARM-003

**Source requirement:** The arm interface shall expose all feedback supported by the arm motors, including applicable position, velocity, current/torque, temperature and fault information.

| Source field | Value |
| --- | --- |
| Source | Control!A9:N9 |
| Parent / source | Interview Q05 |
| Subsystem / type | Robotic arm / Telemetry |
| Priority / owner | P0 / Control / Manipulation |
| Source status / provisional | Open / No |
| Rationale / objective | Support safe control, GUI display and diagnostics. |
| Verification method | CAN message test; ROS integration test |
| Acceptance / source evidence | Supported feedback fields, units, rates and validity states are documented and published. |
| Dependencies | Motor CAN protocol; telemetry contract |
| Source notes / open actions | Exact supported feedback and CAN message definitions remain to be confirmed. |

**Review assessment:** Partial; pending hardware and telemetry contract. **Plan stage:** 2, 3, 4, 5.

E1/E2 publish real parsed motor telemetry and joint state; E7 publishes readiness. Confirm units and supported fields on hardware. Raw messages lack explicit sample timestamps/validity; current is not automatically torque. Complete GUI validity/rate mapping under E8.

#### ARM-004

**Source requirement:** The arm control stack shall support both direct joint commands and higher-level trajectory/planning control, including MoveIt 2 integration where applicable.

| Source field | Value |
| --- | --- |
| Source | Control!A10:N10 |
| Parent / source | Interview Q06 / existing RTM CTRL-005 |
| Subsystem / type | Robotic arm / Functional |
| Priority / owner | P0 / Control / Manipulation |
| Source status / provisional | Open / No |
| Rationale / objective | Support manual operation and future/required task-level motion planning. |
| Verification method | Unit, integration and simulation/bench tests |
| Acceptance / source evidence | Direct joint command path and trajectory path both produce bounded, validated motor commands. |
| Dependencies | Joint limits; motor feedback; ROS 2 interfaces |
| Source notes / open actions | Answer: C. Exact MoveIt 2 scope remains to be defined. |

**Review assessment:** Partial; missing production manual adapter. **Plan stage:** 2, 3, 4.

E1 has bounded direct joint control and E9 has MoveIt trajectory execution. E5/E6 show that the GUI manual Joy path currently terminates in mock code. Add production manual/mode mapping and the one-joint test configuration; validate handover and both paths on hardware.

#### ARM-005

**Source requirement:** The rover-side arm controller shall reject or clamp commands beyond configured joint soft limits independently of GUI validation.

| Source field | Value |
| --- | --- |
| Source | Control!A11:N11 |
| Parent / source | Existing RTM CTRL-005 |
| Subsystem / type | Arm safety / Safety |
| Priority / owner | P0 / Control / Manipulation / GUI |
| Source status / provisional | Open / No |
| Rationale / objective | Prevent arm over-travel if GUI validation is unavailable or bypassed. |
| Verification method | Boundary-condition bench test |
| Acceptance / source evidence | Out-of-range commands are rejected/clamped; protection state is exposed as NORMAL/ALTERNATE/DIRECT as applicable. |
| Dependencies | Joint limit values; FMA LAW contract |
| Source notes / open actions | Existing RTM marks this as a blocking requirement. |

**Review assessment:** Partial; limits implemented, protection annunciation gap. **Plan stage:** 2, 4, 5.

E1 rejects direct out-of-range positions/speeds, clamps controller positions and blocks outward speed near joint limits. E3 supplies limits. Confirm physical calibration and stopping margin. No production publisher was found for the complete NORMAL/ALTERNATE/DIRECT and override contract; direct joint mode is not that LAW state.

#### EE-001

**Source requirement:** The end effector shall include a camera and actuators; the exact actuator types and mechanical functions shall be documented.

| Source field | Value |
| --- | --- |
| Source | Control!A12:N12 |
| Parent / source | Interview Q07 |
| Subsystem / type | End effector / Hardware/interface |
| Priority / owner | P1 / Manipulation / Electrical |
| Source status / provisional | Open / No |
| Rationale / objective | Define the end-effector hardware boundary. |
| Verification method | Design review; inspection |
| Acceptance / source evidence | Bill of materials, mechanical drawing and electrical interface identify camera and every actuator. |
| Dependencies | End-effector PCB; camera interface |
| Source notes / open actions | Questionnaire answer: camera and actuators. |

**Review assessment:** Gap; hardware definition pending. **Plan stage:** Later EE inspection.

E11 implements speed/position/laser command encodings but does not establish the actual actuator functions or camera hardware. Record the hardware inventory, electrical/mechanical boundary and controller responses before EE motion tests.

#### EE-002

**Source requirement:** The end-effector electronics shall use I2C for the identified end-effector interface; the camera communication protocol shall remain TBD until confirmed.

| Source field | Value |
| --- | --- |
| Source | Control!A13:N13 |
| Parent / source | Interview Q08 |
| Subsystem / type | End effector / Interface |
| Priority / owner | P0 / Electrical / Perception |
| Source status / provisional | Open / No |
| Rationale / objective | Avoid assuming an unsupported camera protocol while preserving the known I2C decision. |
| Verification method | Electrical inspection; bus test; camera streaming test |
| Acceptance / source evidence | I2C devices and addresses documented; camera protocol selected and tested before design freeze. |
| Dependencies | End-effector hardware selection |
| Source notes / open actions | Questionnaire: end effector uses I2C; camera protocol unknown. CAN is only a suggestion, not a decision. |

**Review assessment:** Gap; topology and camera protocol unconfirmed. **Plan stage:** Later EE integration.

E11 only implements upstream CAN commands. No downstream I2C implementation or camera protocol is established by this driver. Determine whether the EE PCB owns I2C devices, document addresses, and select/test the camera interface separately.

### Shared requirements directly applicable to arm control

#### CTRL-001

**Source requirement:** The rover shall use two separate physical controllers, with drivetrain and arm control mutually exclusive.

| Source field | Value |
| --- | --- |
| Source | Control!A14:N14 |
| Parent / source | Interview Q09–Q10 |
| Subsystem / type | Operator control / Safety/interface |
| Priority / owner | P0 / GUI / Control |
| Source status / provisional | Open / No |
| Rationale / objective | Prevent simultaneous conflicting operator commands and match the agreed operator concept. |
| Verification method | Operator demonstration; integration test |
| Acceptance / source evidence | Separate drive and arm controllers are identified; only the active subsystem can receive motion commands. |
| Dependencies | ROS topics; controller hardware selection |
| Source notes / open actions | Answer: two separate controllers; simultaneous operation: no. |

**Review assessment:** Partial; rover-side authority gap. **Plan stage:** 4, 5.

E5 performs GUI-local gating, but E1 accepts direct commands independently of drive authority and no production Joy/mode arbiter was found. Implement and verify rover-side mutual exclusion with acknowledged arm authority.

#### CTRL-002

**Source requirement:** The controller hardware/model shall be selected and documented; the software interface shall remain controller-agnostic until selection.

| Source field | Value |
| --- | --- |
| Source | Control!A15:N15 |
| Parent / source | Interview Q11 |
| Subsystem / type | Operator control / Interface |
| Priority / owner | P1 / GUI / Control |
| Source status / provisional | Open / Yes |
| Rationale / objective | Permit hardware selection without redesigning the control stack. |
| Verification method | Design review; input integration test |
| Acceptance / source evidence | Selected controller model, OS device path, mapping and failure behaviour documented. |
| Dependencies | ROS sensor_msgs/Joy boundary |
| Source notes / open actions | Controller is unknown/TBD. |

**Review assessment:** Partial; hardware selection pending. **Plan stage:** 4.

E5 provides a Joy-based boundary, but the selected controller model/device path and the production mapping into E1 still require confirmation. Record neutral, release, unplug and reconnect behaviour.

#### CAN-001

**Source requirement:** The existing PEAK CAN adapter and installed Jetson drivers shall remain the baseline CAN configuration unless a controlled change is approved.

| Source field | Value |
| --- | --- |
| Source | Control!A22:N22 |
| Parent / source | Interview Q17 |
| Subsystem / type | Electrical / Control / Configuration |
| Priority / owner | P0 / Control / Electrical |
| Source status / provisional | Open / No |
| Rationale / objective | Preserve the known working rover configuration. |
| Verification method | Driver/version audit; CAN loopback and motor test |
| Acceptance / source evidence | Driver package/version, kernel compatibility and setup procedure are recorded; CAN communication passes regression test. |
| Dependencies | Jetson image; PEAK adapter |
| Source notes / open actions | Answer: Yes. |

**Review assessment:** Pending hardware/configuration audit. **Plan stage:** 1, 2.

E4 expects SocketCAN. Record the existing PEAK adapter and Jetson driver/kernel versions; reconcile the plan's club board identity. Do not silently treat a different serial adapter as equivalent.

#### ESTOP-001

**Source requirement:** The E-stop shall cut power from the battery to the rover system as defined by the approved electrical safety design.

| Source field | Value |
| --- | --- |
| Source | Control!A29:N29 |
| Parent / source | Interview Q24 / ARCh |
| Subsystem / type | Safety / Electrical / Safety |
| Priority / owner | P0 / Electrical / Safety |
| Source status / provisional | Open / No |
| Rationale / objective | Ensure immediate removal of rover power during emergency conditions. |
| Verification method | Electrical inspection; E-stop test |
| Acceptance / source evidence | Activation removes intended power; reset does not cause unexpected motion; power logger remains compliant with ARCh requirements where applicable. |
| Dependencies | Battery; contactor/kill switch; power logger |
| Source notes / open actions | Answer: cuts power from battery to everything. Exact circuit architecture must be documented. |

**Review assessment:** Pending electrical test; software response exists. **Plan stage:** Pre-test, 5.

E1/E11 react to /estop with CAN zero-speed commands. This is not proof that battery power is removed. Verify the approved physical power-cut circuit, reachable disconnect, software indication and no automatic motion after reset.

#### SAFE-001

**Source requirement:** A 250 ms motion-command or link-loss timeout shall trigger a safe stop, subject to bench and field validation.

| Source field | Value |
| --- | --- |
| Source | Control!A30:N30 |
| Parent / source | Interview Q25 / existing RTM CTRL-007 |
| Subsystem / type | Safety / Control / Safety |
| Priority / owner | P0 / Control / GUI / Communications |
| Source status / provisional | Open / Yes |
| Rationale / objective | Prevent runaway motion after command or communication loss. |
| Verification method | Timed disconnect test; field test |
| Acceptance / source evidence | Drive and arm motion stop within the validated safety budget after command/link loss. |
| Dependencies | ROS, gamepad and radio watchdogs |
| Source notes / open actions | 250 ms answer; provisional until measured. |

**Review assessment:** Gap; feedback timeout exists, command timeout missing. **Plan stage:** 2, 4, 5.

E1 has a 250 ms encoder/status timeout, but direct speed is latched without a command-age deadline. Healthy feedback can coexist with a lost operator. Add command/deadman supervision and establish controller-side protection for CAN/process loss. Measure physical stop latency against the provisional source budget.

#### TEL-001

**Source requirement:** All required GUI/base-station telemetry shall be defined by SD page, criticality and update rate in the Chasmata telemetry requirements document.

| Source field | Value |
| --- | --- |
| Source | Control!A33:N33 |
| Parent / source | Interview Q28 / existing RTM CTRL-008 |
| Subsystem / type | Telemetry / GUI / Interface |
| Priority / owner | P0 / Control / GUI |
| Source status / provisional | Open / No |
| Rationale / objective | Provide consistent real data to GUI and system display consumers. |
| Verification method | Interface review; ROS integration test |
| Acceptance / source evidence | Telemetry contract includes message names, fields, units, rates, validity and fault semantics. |
| Dependencies | ROS topics; motor feedback; network |
| Source notes / open actions | Questionnaire points to gui/docs/telemetry-requirements.md. |

**Review assessment:** Partial; live GUI contract incomplete. **Plan stage:** 3, 4, 5.

E8 defines GUI rates, validity and fault semantics. E1/E7 supply raw arm data and readiness, but the production FMA/LAW and arm fault translation are not connected. Map fields, source ownership, staleness and recovery snapshots without presenting mocks as measured state.

#### TEL-002

**Source requirement:** Where applicable, telemetry shall cover battery/power, motor temperature/current, commanded and actual wheel speed, joint position/velocity/current, CAN and RS485 health, camera health, network latency, ROS node health, E-stop, LEDs, controller and watchdog state.

| Source field | Value |
| --- | --- |
| Source | Control!A34:N34 |
| Parent / source | Interview Q28 |
| Subsystem / type | Telemetry / Telemetry |
| Priority / owner | P0 / Control / GUI / Electrical |
| Source status / provisional | Open / No |
| Rationale / objective | Support operator awareness, diagnostics and verification. |
| Verification method | End-to-end telemetry test |
| Acceptance / source evidence | Each applicable item is present in the approved telemetry contract with source, rate and criticality. |
| Dependencies | Hardware capabilities; telemetry contract |
| Source notes / open actions | Do not assume unsupported fields; mark unavailable fields explicitly. |

**Review assessment:** Partial for arm telemetry. **Plan stage:** 3, 4, 5.

Arm position/velocity, current, temperature and faults are parsed in E1/E2; CAN diagnostics exist in E4. Complete the arm subset of the approved telemetry contract, including CAN health, inhibit/limit/watchdog and E-stop state. Mark unsupported torque or EE feedback unavailable.

#### FAULT-001

**Source requirement:** Motor faults shall be handled according to a documented severity-based fault classification and safe-state action table.

| Source field | Value |
| --- | --- |
| Source | Control!A35:N35 |
| Parent / source | Interview Q29 / existing RTM CTRL-007 |
| Subsystem / type | Safety / Control / Safety |
| Priority / owner | P0 / Control / Safety |
| Source status / provisional | Open / Yes |
| Rationale / objective | Avoid treating every fault identically while preventing unsafe motion. |
| Verification method | Fault injection; integration test |
| Acceptance / source evidence | For each fault class, affected motor/side/drivetrain/rover response is deterministic and tested. |
| Dependencies | Motor fault telemetry; E-stop; watchdog |
| Source notes / open actions | Answer: E. Exact severity table is TBD. |

**Review assessment:** Partial; severity and recovery table pending. **Plan stage:** 5.

E1 inhibits arm controller motion on any reported motor fault and clears direct commands; healthy joints can hold position. Agree per-fault stop/hold/disable and reset/re-arm actions. E2's broadcast clear helper is not exposed by a real control API. Feed resulting arm faults into the existing E8 aggregation path.

### GUI requirements at the arm boundary

#### GUI-004

**Source requirement:** The GUI shall provide Arm Ops with arm controls, gamepad feedback, rover-context camera views, a dedicated arm camera view, and clamp/arm status areas. The final camera placement and arm-control interface remain pending CDR confirmation.

| Source field | Value |
| --- | --- |
| Source | GUI!A6:J6 |
| Requirement name / system | Arm operator workspace / Arm dashboard |
| Priority | P0 |
| Source status | Implemented layout; live telemetry, final camera inventory, and physical validation pending. |
| Objective | Support safe and effective remote arm operation. |
| Verification method | Unit tests; operator review; rover bench test |
| Source evidence | layout/arm/ |
| Dependencies | Arm camera; final arm-control contract; final camera/stream interface |

**Review assessment:** Partial at real arm boundary. **Plan stage:** 4.

E5/E7 provide GUI command/state integration points. Layout evidence is not a physical motor result. Finish real manual routing, mode confirmation and live clamp/arm feedback; confirm camera placement with the hardware owners.

#### GUI-005

**Source requirement:** The GUI shall publish approved Pilot and Arm commands through ROSbridge while preventing conflicting command sources within each controlled subsystem and supporting safe mode switching.

| Source field | Value |
| --- | --- |
| Source | GUI!A7:J7 |
| Requirement name / system | Command transport and mode isolation / Control interface |
| Priority | P0 |
| Source status | Implemented; physical validation pending |
| Objective | Prevent conflicting control commands and support safe mode switching. |
| Verification method | Unit tests; disconnected-actuator bench test |
| Source evidence | core/control/ |
| Dependencies | Approved /joy and /arm/joy mappings; rover safe-stop behaviour |

**Review assessment:** Partial; production mode routing gap. **Plan stage:** 4, 5.

Mock Joy/mode consumers exist in E6. Add production arm source ownership, manual/trajectory interlocks, neutral/release handling and rover-confirmed transitions. Test stale goals and handover to the controller target.

#### GUI-006

**Source requirement:** The GUI shall display real system safety state, including E-stop, and shall only expose authorised reset/re-arm behaviour supplied by Control.

| Source field | Value |
| --- | --- |
| Source | GUI!A8:J8 |
| Requirement name / system | Safety-state integration / Control safety |
| Priority | P0 |
| Source status | Not implemented |
| Objective | Make safety state clear without making the GUI the safety authority. |
| Verification method | Hardware-in-the-loop safety test |
| Source evidence | Mission Control currently has E-stop placeholder |
| Dependencies | E-stop hardware; Control safety and re-arm contract |

**Review assessment:** Gap at live safety display and recovery boundary. **Plan stage:** 4, 5.

E1/E7 expose real arm readiness and E-stop-clear state; the GUI telemetry bridge does not directly consume ArmControlStatus. Connect authoritative safety state and only expose confirmed reset/re-arm operations. Keep physical power removal distinct from software stop.

#### GUI-007

**Source requirement:** The system shall enforce configurable virtual end-stops to prevent arm motion beyond defined soft limits, with GUI-side validation where available. An explicit, authorised override shall permit bypass when necessary and shall be clearly annunciated. The GUI shall display the confirmed arm control law: NORMAL when both GUI and rover protection are active; ALTERNATE when rover protection remains active but GUI-side protection or telemetry is unavailable; and DIRECT when protection is overridden or unavailable.

| Source field | Value |
| --- | --- |
| Source | GUI!A9:J9 |
| Requirement name / system | Arm virtual end-stop protection law / Arm safety / FMA |
| Priority | P0 |
| Source status | Implemented; end-to-end telemetry and physical verification pending |
| Objective | Prevent arm movement beyond approved soft limits and make any reduced-protection or override state unmistakable to Arm Ops. |
| Verification method | Boundary-condition bench test; verify rejected out-of-limit command; verify LAW annunciation and override warning |
| Source evidence | gui/docs/fma.md; FMA LAW column; rover Control virtual end-stop implementation |
| Dependencies | Rover-side virtual end-stop enforcement; arm position telemetry; protection-law status; authorised override contract |

**Review assessment:** Partial; physical and LAW/override integration pending. **Plan stage:** 2, 4, 5.

E1 enforces rover soft limits independently. E8 defines the LAW/override display contract, but the real arm driver does not implement the complete authorised override and FMA publication path. Verify boundary rejection and reduced-protection annunciation using real telemetry.

#### GUI-008

**Source requirement:** The GUI shall display confirmed DRIVE, ARM, LAW, SYSTEM, and LINK states, distinguish commanded state from rover-confirmed state, and use consistent visual status semantics.

| Source field | Value |
| --- | --- |
| Source | GUI!A10:J10 |
| Requirement name / system | Functional Mode Annunciator / FMA |
| Priority | P1 |
| Source status | Implemented with mock state; live integration pending |
| Objective | Provide all operators with a shared operational summary. |
| Verification method | Unit tests; ROS integration test |
| Source evidence | core/fma/; gui/docs/fma.md |
| Dependencies | Rover telemetry; command acknowledgement contract |

**Review assessment:** Partial for arm FMA; real confirmation missing. **Plan stage:** 4, 5.

E7 consumes /fma/state and E6 supplies mock state. Connect the arm portion to real hardware readiness, ownership and request decisions. A source status of implemented with mock state does not prove live motor authority.

#### GUI-009

**Source requirement:** The GUI shall present prioritised ECAM alerts with consistent colour semantics and optionally display remotely actionable troubleshooting procedures.

| Source field | Value |
| --- | --- |
| Source | GUI!A11:J11 |
| Requirement name / system | ECAM alerting and operator procedures / ECAM |
| Priority | P1 |
| Source status | Implemented locally; telemetry integration pending |
| Objective | Explain what needs attention and guide operator recovery. |
| Verification method | Unit tests; operator review; ROS integration test |
| Source evidence | core/ecam/; ECAM alert display |
| Dependencies | Rover fault taxonomy; approved operator procedures |

**Review assessment:** Partial for arm alerts; real fault source missing. **Plan stage:** 4, 5.

E8 already provides shared ECAM aggregation. Connect real arm fault/inhibit/CAN events to approved alert codes and recovery procedures; do not build a duplicate aggregator.

#### GUI-011

**Source requirement:** The GUI shall provide DRIVE, ARM, POWER, LINK, CAMERA, and SYSTEM diagnostic pages for subsystem telemetry and symbolic schematics.

| Source field | Value |
| --- | --- |
| Source | GUI!A13:J13 |
| Requirement name / system | System Display diagnostics / System Display |
| Priority | P1 |
| Source status | Navigation and page shells implemented; content pending |
| Objective | Allow operators to inspect the affected subsystem after an alert. |
| Verification method | Design review; ROS integration test |
| Source evidence | layout/ecam-panel/ecam-system-display/ |
| Dependencies | CDR-approved subsystem topology; telemetry contract |

**Review assessment:** Partial for ARM diagnostics. **Plan stage:** 3, 4, 5.

E8 specifies ARM display data. Verify real position/velocity/current/temperature, faults, CAN health and validity reach the ARM display. GUI shells alone do not satisfy live diagnostics.

#### GUI-012

**Source requirement:** The GUI shall visualise arm configuration and state from the agreed robot description, joint states, TF frames, limits, and MoveIt execution state.

| Source field | Value |
| --- | --- |
| Source | GUI!A14:J14 |
| Requirement name / system | Arm simulation and digital twin / Arm simulation |
| Priority | P1 |
| Source status | Blocked by rover design and Control/Arm contract |
| Objective | Provide accurate arm situational awareness and future simulation support. |
| Verification method | Simulation test; ROS integration test |
| Source evidence | c_rover_2027-context.md |
| Dependencies | CDR; URDF; MoveIt 2; Control/Arm telemetry contract |

**Review assessment:** Partial; models agree, hardware and geometry pending. **Plan stage:** Later trajectory integration.

E9 implements MoveIt execution/status and E7 consumes joint states. Reviewed models agree on joint names and limits; E3/E10 contain no collision geometry. Calibrate actual geometry, frames and encoder conventions; do not claim collision avoidance from the present model.

#### GUI-013

**Source requirement:** The GUI shall consume the documented rover telemetry, health, fault, and command-handshake interfaces to replace mock state.

| Source field | Value |
| --- | --- |
| Source | GUI!A15:J15 |
| Requirement name / system | GUI-rover telemetry integration / ROS interface |
| Priority | P0 |
| Source status | Blocked by rover-side contracts |
| Objective | Make all operator displays reflect validated live rover state. |
| Verification method | ROS integration test; physical rover validation |
| Source evidence | c_rover_2027-context.md |
| Dependencies | Control and Autonomy ROS topic/message/update-rate contract |

**Review assessment:** Partial for arm; live health/fault/handshake gap. **Plan stage:** 3, 4, 5.

Connect E1/E7 real feedback/readiness and E4 diagnostics to the E8 contract. Prove reconnect, stale/unknown indications, fault propagation and mode acknowledgements without relying on mock publishers.
