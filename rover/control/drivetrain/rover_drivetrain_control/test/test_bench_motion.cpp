// Bench motion against four simulated BLD-305S drives. The real hardware
// interface and driver run; every libmodbus call is mocked, so no serial port
// is opened and nothing can move.
#include "rover_drivetrain_control/rover_hardware_interface.hpp"

#include <modbus/modbus.h>
#include <rclcpp/rclcpp.hpp>

#include <array>
#include <cerrno>
#include <cmath>
#include <chrono>
#include <thread>
#include <cstdint>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#define CHECK(e) do { if (!(e)) throw std::runtime_error(#e); } while(false)

struct _modbus {
  int slave{-1};
  bool connected{false};
};

namespace
{

struct Drive
{
  std::map<int, std::uint16_t> regs;
  bool present{true};              // answers at all
  bool garbled{false};             // CRC error, e.g. two drives answering at one address
  bool short_reply{false};         // wrong register count in the reply
  bool ignores_pole_pairs{false};  // keeps its stored pole pairs
  bool stuck_running{false};       // acknowledges stop but keeps running
  bool control_write_times_out{false};  // 0x0066 writes get no reply (broadcast unaffected)
  bool speed_write_times_out{false};    // 0x0056 writes get no reply
  std::map<int, int> read_errno;        // per-register read failure, e.g. EMBXILADD (exception 2)
};

struct WriteRecord
{
  int slave;
  int address;
  std::uint16_t value;
};

_modbus * context{nullptr};
std::array<Drive, 5> drives;  // index = slave ID 1..4
std::vector<WriteRecord> writes;      // since the last resetDrives()
std::vector<WriteRecord> all_writes;  // whole run, for the forbidden-register check
unsigned broadcasts{0};

void resetDrives()
{
  for (auto & d : drives) {
    d = Drive{};
    d.regs[0x0116] = 5;  // manual default pole pairs
    d.regs[0x0136] = 1;  // internal mode
    d.regs[0x0056] = 0x05DC;  // manual default speed setting: 1500 RPM
  }
  for (int id = 1; id <= 4; ++id) drives[id].regs[0x00A6] = static_cast<std::uint16_t>(id);
  writes.clear();
  broadcasts = 0;
}

bool allStopped()
{
  for (int id = 1; id <= 4; ++id) {
    if (drives[id].regs[0x0066] != 0) return false;
  }
  return true;
}

}  // namespace

extern "C" {
modbus_t * modbus_new_rtu(const char *, int, char, int, int)
{
  CHECK(context == nullptr);
  context = new _modbus;
  return context;
}
int modbus_set_response_timeout(modbus_t *, std::uint32_t, std::uint32_t) {return 0;}
int modbus_connect(modbus_t * m) {m->connected = true; return 0;}
void modbus_close(modbus_t * m) {m->connected = false;}
void modbus_free(modbus_t * m) {CHECK(m == context); delete m; context = nullptr;}
int modbus_set_slave(modbus_t * m, int slave)
{
  CHECK(m == context && m->connected);
  CHECK(slave >= 0 && slave <= 4);
  m->slave = slave;
  return 0;
}
int modbus_read_registers(modbus_t * m, int addr, int n, std::uint16_t * out)
{
  CHECK(m == context && m->connected && n == 1);
  CHECK(m->slave >= 1);  // never a read from the broadcast address
  Drive & d = drives[m->slave];
  if (!d.present) {errno = ETIMEDOUT; return -1;}
  if (d.garbled) {errno = EMBBADCRC; return -1;}
  if (const auto it = d.read_errno.find(addr); it != d.read_errno.end()) {
    errno = it->second;  // libmodbus: exception N is MODBUS_ENOBASE + N
    return -1;
  }
  *out = d.regs[addr];
  return d.short_reply ? 2 : 1;
}
int modbus_write_register(modbus_t * m, int addr, const std::uint16_t value)
{
  CHECK(m == context && m->connected);
  writes.push_back({m->slave, addr, value});
  all_writes.push_back({m->slave, addr, value});
  if (m->slave == 0) {
    ++broadcasts;
    for (int id = 1; id <= 4; ++id) {
      Drive & d = drives[id];
      if (d.present && !(d.stuck_running && value == 0)) d.regs[addr] = value;
    }
    // libmodbus 3.1.10 waits response_timeout for a reply that never comes.
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
    errno = ETIMEDOUT;
    return -1;
  }
  Drive & d = drives[m->slave];
  if (!d.present) {errno = ETIMEDOUT; return -1;}
  if (d.garbled) {errno = EMBBADCRC; return -1;}
  if (addr == 0x0066 && d.control_write_times_out) {errno = ETIMEDOUT; return -1;}
  if (addr == 0x0056 && d.speed_write_times_out) {errno = ETIMEDOUT; return -1;}
  if (addr == 0x0066 && value == 0 && d.stuck_running) return 1;
  if (addr == 0x0116 && d.ignores_pole_pairs) return 1;
  d.regs[addr] = value;
  return 1;
}
}

namespace
{

using Hardware = rover_drivetrain_control::RoverHardwareInterface;
using Params = hardware_interface::HardwareComponentInterfaceParams;
using CallbackReturn = hardware_interface::CallbackReturn;
using ReturnType = hardware_interface::return_type;

const rclcpp_lifecycle::State lifecycle_state;
const rclcpp::Time t0;
const rclcpp::Duration dt(0, 0);

Params params(bool bench)
{
  Params p;
  auto & info = p.hardware_info;
  info.name = "DCRDrivetrainBenchTest";
  info.type = "system";
  if (bench) {
    // Values from the bench timing working in the README.
    info.hardware_parameters = {
      {"serial_device", "/dev/bench-mock"}, {"baud_rate", "9600"}, {"parity", "N"},
      {"data_bits", "8"}, {"stop_bits", "1"}, {"response_timeout_ms", "50"},
      {"update_hz", "2"}, {"upstream_timeout_ms", "110"}, {"stop_deadline_ms", "300"},
      {"measured_stop_wire_budget_ms", "200"}, {"measured_worst_bus_cycle_ms", "245"},
      {"late_trigger_ms", "750"},
      {"bench_motion_enabled", "true"}, {"pole_pairs", "4"}, {"bench_rpm_cap", "300"},
      {"bench_stop_deadline_ms", "1500"}};
  } else {
    info.hardware_parameters = {
      {"serial_device", "/dev/bench-mock"}, {"baud_rate", "38400"}, {"parity", "N"},
      {"data_bits", "8"}, {"stop_bits", "1"},
      {"update_hz", "15"}, {"upstream_timeout_ms", "110"}, {"stop_deadline_ms", "300"},
      {"measured_stop_wire_budget_ms", "5"}, {"measured_worst_bus_cycle_ms", "30"},
      {"late_trigger_ms", "100"}};
  }
  const std::array<std::string, 4> names{
    "front_left_wheel_joint", "rear_left_wheel_joint",
    "front_right_wheel_joint", "rear_right_wheel_joint"};
  for (std::size_t i = 0; i < names.size(); ++i) {
    hardware_interface::ComponentInfo joint;
    joint.name = names[i];
    joint.type = "joint";
    hardware_interface::InterfaceInfo velocity{};
    velocity.name = "velocity";
    joint.command_interfaces.push_back(velocity);
    joint.state_interfaces.push_back(velocity);
    joint.parameters = {
      {"slave_id", std::to_string(i + 1)}, {"gear_ratio", "50"},
      {"motor_rpm_limit", "2000"}, {"mirrored", i >= 2 ? "true" : "false"}};
    info.joints.push_back(joint);
  }
  return p;
}

ReturnType cycle(Hardware & hw)
{
  const auto r = hw.read(t0, dt);
  if (r != ReturnType::OK) return r;
  return hw.write(t0, dt);
}

struct ActiveBench
{
  std::unique_ptr<Hardware> hw = std::make_unique<Hardware>();
  std::vector<hardware_interface::CommandInterface> commands;
  std::vector<hardware_interface::StateInterface> states;

  ActiveBench()
  {
    CHECK(hw->on_init(params(true)) == CallbackReturn::SUCCESS);
    commands = hw->export_command_interfaces();
    states = hw->export_state_interfaces();
    CHECK(commands.size() == 4 && states.size() == 4);
    CHECK(hw->on_configure(lifecycle_state) == CallbackReturn::SUCCESS);
    CHECK(hw->on_activate(lifecycle_state) == CallbackReturn::SUCCESS);
    writes.clear();
    broadcasts = 0;
  }

  void command(std::size_t wheel, double rad_s) {(void)commands[wheel].set_value(rad_s);}

  // Exported wheel velocity, as the controllers see it. NaN means "no current reading".
  double velocity(std::size_t wheel) const
  {
    const auto value = states[wheel].get_optional<double>();
    CHECK(value.has_value());
    return *value;
  }
};

void testDisabledRefusesAsToday()
{
  for (bool explicit_false : {true, false}) {
    resetDrives();
    auto p = params(false);
    if (explicit_false) p.hardware_info.hardware_parameters["bench_motion_enabled"] = "false";
    Hardware hw;
    CHECK(hw.on_init(p) == CallbackReturn::SUCCESS);
    CHECK(hw.on_configure(lifecycle_state) == CallbackReturn::ERROR);
    CHECK(hw.on_activate(lifecycle_state) == CallbackReturn::ERROR);
    CHECK(hw.read(t0, dt) == ReturnType::ERROR);
    CHECK(hw.write(t0, dt) == ReturnType::ERROR);
    CHECK(writes.empty());
  }
  // Without bench mode, 9600 baud and a lower rate are still refused.
  for (const auto & [key, value] : std::vector<std::pair<std::string, std::string>>{
      {"baud_rate", "9600"}, {"update_hz", "2"}}) {
    auto p = params(false);
    p.hardware_info.hardware_parameters[key] = value;
    Hardware hw;
    CHECK(hw.on_init(p) == CallbackReturn::ERROR);
  }
}

void testBenchParameterRefusals()
{
  for (const auto & key : {"pole_pairs", "bench_rpm_cap", "bench_stop_deadline_ms"}) {
    auto p = params(true);
    p.hardware_info.hardware_parameters.erase(key);
    Hardware hw;
    CHECK(hw.on_init(p) == CallbackReturn::ERROR);
  }
  for (const auto & [key, value] : std::vector<std::pair<std::string, std::string>>{
      {"bench_rpm_cap", "501"}, {"bench_rpm_cap", "0"}, {"pole_pairs", "0"},
      {"pole_pairs", "256"}, {"bench_motion_enabled", "True"}, {"update_hz", "2.5"},
      {"baud_rate", "19200"},
      {"measured_worst_bus_cycle_ms", "100"},     // below the 187.5 ms wire floor
      {"measured_stop_wire_budget_ms", "100"},    // below the 153.6 ms stop floor
      {"bench_stop_deadline_ms", "1000"}}) {      // < 110 + 2 x 500 + 200
    auto p = params(true);
    p.hardware_info.hardware_parameters[key] = value;
    Hardware hw;
    CHECK(hw.on_init(p) == CallbackReturn::ERROR);
  }
}

void testConfigureRefusals()
{
  auto expect_configure_refused = [](auto && break_drives) {
      resetDrives();
      break_drives();
      Hardware hw;
      CHECK(hw.on_init(params(true)) == CallbackReturn::SUCCESS);
      CHECK(hw.on_configure(lifecycle_state) == CallbackReturn::ERROR);
      CHECK(hw.on_activate(lifecycle_state) == CallbackReturn::ERROR);
      CHECK(writes.empty());
    };
  expect_configure_refused([] {drives[3].regs[0x00A6] = 1;});   // wrong ID
  expect_configure_refused([] {drives[2].regs[0x0076] = 8;});   // fault present (stalled)
  expect_configure_refused([] {drives[1].garbled = true;});     // two drives answering at ID 1
  expect_configure_refused([] {drives[2].short_reply = true;}); // malformed reply
  expect_configure_refused([] {drives[4].present = false;});    // shared address: ID 4 silent
}

void testActivationSequence()
{
  resetDrives();
  Hardware hw;
  CHECK(hw.on_init(params(true)) == CallbackReturn::SUCCESS);
  CHECK(hw.on_configure(lifecycle_state) == CallbackReturn::SUCCESS);
  CHECK(writes.empty());  // configure only reads
  CHECK(hw.on_activate(lifecycle_state) == CallbackReturn::SUCCESS);
  CHECK(writes.size() == 16);
  for (int id = 1; id <= 4; ++id) {
    const auto base = static_cast<std::size_t>(id - 1) * 4;
    CHECK(writes[base].slave == id && writes[base].address == 0x0136 && writes[base].value == 1);
    CHECK(writes[base + 1].address == 0x0116 && writes[base + 1].value == 4);
    CHECK(writes[base + 2].address == 0x0056 && writes[base + 2].value == 0);  // before stop
    CHECK(writes[base + 3].address == 0x0066 && writes[base + 3].value == 0);
    CHECK(drives[id].regs[0x0116] == 4);
    CHECK(drives[id].regs[0x0056] == 0);  // stored 1500 RPM setpoint zeroed
  }
  CHECK(broadcasts == 0);
  CHECK(hw.on_deactivate(lifecycle_state) == CallbackReturn::SUCCESS);
}

void testPolePairsMismatchRefusesAndStopsAll()
{
  resetDrives();
  drives[2].ignores_pole_pairs = true;
  for (int id = 1; id <= 4; ++id) drives[id].regs[0x0066] = 1;  // pretend running
  Hardware hw;
  CHECK(hw.on_init(params(true)) == CallbackReturn::SUCCESS);
  CHECK(hw.on_configure(lifecycle_state) == CallbackReturn::SUCCESS);
  CHECK(hw.on_activate(lifecycle_state) == CallbackReturn::ERROR);
  CHECK(broadcasts >= 1);
  CHECK(allStopped());
  CHECK(hw.write(t0, dt) == ReturnType::ERROR);
}

// Activation for one drive set-up; true if it succeeded. Failures must stop all four.
bool activateWith(const std::function<void()> & set_up_drives)
{
  resetDrives();
  for (int id = 1; id <= 4; ++id) drives[id].regs[0x0066] = 1;  // pretend running
  set_up_drives();
  Hardware hw;
  CHECK(hw.on_init(params(true)) == CallbackReturn::SUCCESS);
  CHECK(hw.on_configure(lifecycle_state) == CallbackReturn::SUCCESS);
  const bool ok = hw.on_activate(lifecycle_state) == CallbackReturn::SUCCESS;
  if (!ok) {
    CHECK(broadcasts >= 1);
    CHECK(allStopped());
    CHECK(hw.write(t0, dt) == ReturnType::ERROR);
  } else {
    CHECK(hw.on_deactivate(lifecycle_state) == CallbackReturn::SUCCESS);
  }
  return ok;
}

void testControlModeReadBack()
{
  // Exception 2 (illegal data address) on the 0x0136 read: the FC06 echo of
  // 0x0136=1 is accepted, with a warning, on every drive.
  CHECK(activateWith([] {
      for (int id = 1; id <= 4; ++id) drives[id].read_errno[0x0136] = EMBXILADD;
    }));
  std::size_t mode_writes = 0;
  for (const auto & w : writes) mode_writes += w.address == 0x0136 && w.value == 1;
  CHECK(mode_writes == 4);

  // Any other 0x0136 read-back failure still refuses.
  CHECK(!activateWith([] {drives[2].read_errno[0x0136] = EMBXILFUN;}));  // exception 1
  CHECK(!activateWith([] {drives[2].read_errno[0x0136] = EMBXILVAL;}));  // exception 3
  CHECK(!activateWith([] {drives[2].read_errno[0x0136] = ETIMEDOUT;}));  // no reply
  CHECK(!activateWith([] {drives[2].read_errno[0x0136] = EMBBADCRC;}));  // garbled
  // The exception-2 allowance is for 0x0136 only, never for pole pairs.
  CHECK(!activateWith([] {drives[2].read_errno[0x0116] = EMBXILADD;}));
}

void testSpeedZeroWriteFailureRefuses()
{
  // 0x0056 has no documented read-back: a missing write echo refuses.
  CHECK(!activateWith([] {drives[3].speed_write_times_out = true;}));
  bool stop_after_failed_speed = false;
  for (const auto & w : writes) {
    stop_after_failed_speed |= w.slave == 3 && w.address == 0x0066;
  }
  CHECK(!stop_after_failed_speed);  // refused before its per-drive stop; the broadcast stopped it
}

void testMotionConversionAndChangeOnlyWrites()
{
  resetDrives();
  ActiveBench bench;
  bench.command(0, 1.0);     // 477.5 motor RPM -> clamped to 300, forward
  bench.command(1, 0.0001);  // 0.05 motor RPM -> deadband: stop
  bench.command(2, 1.0);     // mirrored: reverse, clamped to 300
  bench.command(3, -0.1);    // -47.7 RPM, mirrored -> forward 48

  // Cycle 1: from stop, speed first.
  CHECK(cycle(*bench.hw) == ReturnType::OK);
  CHECK(drives[1].regs[0x0056] == 300 && drives[1].regs[0x0066] == 0);
  CHECK(drives[3].regs[0x0056] == 300 && drives[3].regs[0x0066] == 0);
  CHECK(drives[4].regs[0x0056] == 48 && drives[4].regs[0x0066] == 0);
  CHECK(writes.size() == 3);  // wheel 2 is stopped and unchanged: nothing sent

  // Cycle 2: then direction.
  CHECK(cycle(*bench.hw) == ReturnType::OK);
  CHECK(drives[1].regs[0x0066] == 1);
  CHECK(drives[3].regs[0x0066] == 2);
  CHECK(drives[4].regs[0x0066] == 1);
  CHECK(drives[2].regs[0x0066] == 0);
  CHECK(writes.size() == 6);

  // Cycle 3: nothing changed and nothing is due yet.
  CHECK(cycle(*bench.hw) == ReturnType::OK);
  CHECK(writes.size() == 6);

  // Reversal goes through stop: stop, then speed, then direction.
  bench.command(0, -0.5);  // 238.7 RPM reverse
  CHECK(cycle(*bench.hw) == ReturnType::OK);
  CHECK(drives[1].regs[0x0066] == 0);
  CHECK(cycle(*bench.hw) == ReturnType::OK);
  CHECK(drives[1].regs[0x0056] == 239 && drives[1].regs[0x0066] == 0);
  CHECK(cycle(*bench.hw) == ReturnType::OK);
  CHECK(drives[1].regs[0x0066] == 2);
  CHECK(broadcasts == 0);
  CHECK(bench.hw->on_deactivate(lifecycle_state) == CallbackReturn::SUCCESS);
}

void startMoving(ActiveBench & bench)
{
  for (std::size_t w = 0; w < 4; ++w) bench.command(w, 0.2);
  CHECK(cycle(*bench.hw) == ReturnType::OK);
  CHECK(cycle(*bench.hw) == ReturnType::OK);
  CHECK(!allStopped());
  writes.clear();
}

void testFaultBroadcastsStop()
{
  resetDrives();
  ActiveBench bench;
  startMoving(bench);  // two cycles; the next one reads 0x005F, the one after 0x0076
  drives[4].regs[0x0076] = 1;  // overcurrent
  CHECK(cycle(*bench.hw) == ReturnType::OK);
  CHECK(broadcasts == 0);
  CHECK(bench.hw->read(t0, dt) == ReturnType::ERROR);
  CHECK(broadcasts >= 1);
  CHECK(allStopped());
  // Latched: no motion command is ever sent again until re-activation.
  const auto sent = writes.size();
  CHECK(bench.hw->write(t0, dt) == ReturnType::ERROR);
  CHECK(cycle(*bench.hw) == ReturnType::ERROR);
  CHECK(writes.size() == sent);
  drives[4].regs[0x0076] = 0;
  CHECK(bench.hw->on_deactivate(lifecycle_state) == CallbackReturn::SUCCESS);
}

void testLossBroadcastsStop()
{
  resetDrives();
  ActiveBench bench;
  startMoving(bench);
  drives[3].present = false;
  CHECK(cycle(*bench.hw) == ReturnType::OK);   // missed 1
  CHECK(cycle(*bench.hw) == ReturnType::OK);   // missed 2: data invalid
  CHECK(broadcasts == 0);
  // Missed 3. A silent drive has also failed two speed polls by now, so speed
  // freshness stops all four in read(), on the same cycle as the loss.
  CHECK(cycle(*bench.hw) == ReturnType::ERROR);
  CHECK(broadcasts >= 1);
  for (int id : {1, 2, 4}) CHECK(drives[id].regs[0x0066] == 0);  // never one side only
  drives[3].present = true;
  drives[3].regs[0x0066] = 0;
  CHECK(bench.hw->on_deactivate(lifecycle_state) == CallbackReturn::SUCCESS);
}

void testLossByFailedWritesBroadcastsStop()
{
  // Reads keep succeeding, so neither freshness check fires; only the cycle
  // health (lost after 3 missed cycles) catches a drive whose writes fail.
  resetDrives();
  ActiveBench bench;
  startMoving(bench);
  drives[3].speed_write_times_out = true;
  bench.command(2, 0.3);  // force a speed write to drive 3 every cycle
  CHECK(cycle(*bench.hw) == ReturnType::OK);  // speed write fails: missed 1
  CHECK(cycle(*bench.hw) == ReturnType::OK);  // re-sent, fails: missed 2
  CHECK(broadcasts == 0);
  CHECK(bench.hw->read(t0, dt) == ReturnType::OK);      // reads still fine
  CHECK(bench.hw->write(t0, dt) == ReturnType::ERROR);  // missed 3: lost -> stop all
  CHECK(broadcasts >= 1);
  CHECK(allStopped());
  drives[3].speed_write_times_out = false;
  CHECK(bench.hw->on_deactivate(lifecycle_state) == CallbackReturn::SUCCESS);
}

// After startMoving() the cycle index is 2: even cycles read 0x005F, odd ones 0x0076.

void testFailedFaultPollsStopAll()
{
  resetDrives();
  ActiveBench bench;
  startMoving(bench);
  // Fault reads fail on one drive while its speed reads keep succeeding. Each
  // good speed read resets the cycle-health miss counter, so the drive is
  // never "lost"; fault freshness must catch it instead.
  drives[3].read_errno[0x0076] = ETIMEDOUT;
  CHECK(cycle(*bench.hw) == ReturnType::OK);  // speed read OK
  CHECK(cycle(*bench.hw) == ReturnType::OK);  // fault poll 1 fails: not yet a stop
  CHECK(cycle(*bench.hw) == ReturnType::OK);  // speed read OK again
  CHECK(broadcasts == 0);
  CHECK(bench.hw->read(t0, dt) == ReturnType::ERROR);  // fault poll 2 fails: stop all
  // 2 failed polls = 2 poll intervals = 2 s at 2 Hz, inside the 2.5 s limit.
  CHECK(broadcasts >= 1);
  CHECK(allStopped());
  CHECK(cycle(*bench.hw) == ReturnType::ERROR);  // latched like a fault
  drives[3].read_errno.clear();
  CHECK(bench.hw->on_deactivate(lifecycle_state) == CallbackReturn::SUCCESS);
}

void testOneFailedFaultPollRecovers()
{
  resetDrives();
  ActiveBench bench;
  startMoving(bench);
  CHECK(cycle(*bench.hw) == ReturnType::OK);  // speed
  drives[3].read_errno[0x0076] = ETIMEDOUT;
  CHECK(cycle(*bench.hw) == ReturnType::OK);  // fault poll fails once
  drives[3].read_errno.clear();
  for (int i = 0; i < 8; ++i) {  // four more good fault polls
    CHECK(cycle(*bench.hw) == ReturnType::OK);
  }
  CHECK(broadcasts == 0);
  CHECK(!allStopped());
  CHECK(bench.hw->on_deactivate(lifecycle_state) == CallbackReturn::SUCCESS);
}

void testFaultFreshnessResetsOnActivation()
{
  resetDrives();
  ActiveBench bench;
  startMoving(bench);
  CHECK(cycle(*bench.hw) == ReturnType::OK);  // speed
  drives[3].read_errno[0x0076] = ETIMEDOUT;
  CHECK(cycle(*bench.hw) == ReturnType::OK);  // fault poll 1 fails
  drives[3].read_errno.clear();
  CHECK(bench.hw->on_deactivate(lifecycle_state) == CallbackReturn::SUCCESS);
  CHECK(bench.hw->on_activate(lifecycle_state) == CallbackReturn::SUCCESS);
  broadcasts = 0;
  // Without the reset this failed poll would be the second in a row and stop.
  drives[3].read_errno[0x0076] = ETIMEDOUT;
  CHECK(cycle(*bench.hw) == ReturnType::OK);  // cycle 0: speed
  CHECK(cycle(*bench.hw) == ReturnType::OK);  // cycle 1: first failed poll since activation
  CHECK(broadcasts == 0);
  drives[3].read_errno.clear();
  CHECK(bench.hw->on_deactivate(lifecycle_state) == CallbackReturn::SUCCESS);
}

// Speed reads fail on one drive (wheel index 2, ID 3) while its fault reads
// keep succeeding. Each good fault read resets the cycle-health miss counter,
// so the drive is never "lost" and telemetryValid() stays true; speed
// freshness must catch it, and the old reading must not stay exported.

void testFailedSpeedPollsStopAll()
{
  resetDrives();
  drives[3].regs[0x005F] = 300;  // 300 motor RPM -> 0.628 rad/s at the wheel
  ActiveBench bench;
  startMoving(bench);  // cycle 0 read 0x005F, cycle 1 read 0x0076
  CHECK(std::isfinite(bench.velocity(2)) && bench.velocity(2) != 0.0);
  drives[3].read_errno[0x005F] = ETIMEDOUT;
  CHECK(cycle(*bench.hw) == ReturnType::OK);  // speed poll 1 fails: not yet a stop
  CHECK(std::isnan(bench.velocity(2)));       // the old reading is not exported as current
  CHECK(cycle(*bench.hw) == ReturnType::OK);  // fault read OK
  CHECK(std::isnan(bench.velocity(2)));
  CHECK(broadcasts == 0);
  CHECK(bench.hw->read(t0, dt) == ReturnType::ERROR);  // speed poll 2 fails: stop all
  // 2 failed polls = 2 poll intervals = 2 s at 2 Hz, inside the 2.5 s limit.
  CHECK(broadcasts >= 1);
  CHECK(allStopped());
  CHECK(cycle(*bench.hw) == ReturnType::ERROR);  // latched
  drives[3].read_errno.clear();
  CHECK(bench.hw->on_deactivate(lifecycle_state) == CallbackReturn::SUCCESS);
}

void testOneFailedSpeedPollRecovers()
{
  resetDrives();
  drives[3].regs[0x005F] = 300;
  ActiveBench bench;
  startMoving(bench);
  drives[3].read_errno[0x005F] = ETIMEDOUT;
  CHECK(cycle(*bench.hw) == ReturnType::OK);  // speed poll fails once
  CHECK(std::isnan(bench.velocity(2)));
  drives[3].read_errno.clear();
  for (int i = 0; i < 8; ++i) {  // four more good speed polls
    CHECK(cycle(*bench.hw) == ReturnType::OK);
  }
  CHECK(std::isfinite(bench.velocity(2)) && bench.velocity(2) != 0.0);  // fresh reading again
  CHECK(broadcasts == 0);
  CHECK(bench.hw->on_deactivate(lifecycle_state) == CallbackReturn::SUCCESS);
}

void testSpeedFreshnessResetsOnActivation()
{
  resetDrives();
  drives[3].regs[0x005F] = 300;
  ActiveBench bench;
  startMoving(bench);
  CHECK(std::isfinite(bench.velocity(2)));
  drives[3].read_errno[0x005F] = ETIMEDOUT;
  CHECK(cycle(*bench.hw) == ReturnType::OK);  // speed poll 1 fails
  drives[3].read_errno.clear();
  CHECK(cycle(*bench.hw) == ReturnType::OK);  // fault read
  CHECK(bench.hw->on_deactivate(lifecycle_state) == CallbackReturn::SUCCESS);
  CHECK(bench.hw->on_activate(lifecycle_state) == CallbackReturn::SUCCESS);
  broadcasts = 0;
  // Nothing measured before this activation is exported as current.
  for (std::size_t w = 0; w < 4; ++w) CHECK(std::isnan(bench.velocity(w)));
  // Without the reset this failed poll would be the second in a row and stop.
  drives[3].read_errno[0x005F] = ETIMEDOUT;
  CHECK(cycle(*bench.hw) == ReturnType::OK);  // cycle 0: first failed speed poll since activation
  CHECK(broadcasts == 0);
  drives[3].read_errno.clear();
  CHECK(bench.hw->on_deactivate(lifecycle_state) == CallbackReturn::SUCCESS);
}

void testFailedDirectionWriteStopsAll()
{
  resetDrives();
  ActiveBench bench;
  startMoving(bench);
  drives[2].control_write_times_out = true;
  bench.command(1, -0.2);  // wheel 2 must reverse: its stop write fails
  CHECK(cycle(*bench.hw) == ReturnType::ERROR);
  CHECK(broadcasts >= 1);
  CHECK(allStopped());  // all four, not just the wheel that failed
  CHECK(cycle(*bench.hw) == ReturnType::ERROR);  // latched
  drives[2].control_write_times_out = false;
  CHECK(bench.hw->on_deactivate(lifecycle_state) == CallbackReturn::SUCCESS);
}

void testDeactivateBroadcastsAndConfirms()
{
  resetDrives();
  {
    ActiveBench bench;
    startMoving(bench);
    CHECK(bench.hw->on_deactivate(lifecycle_state) == CallbackReturn::SUCCESS);
    CHECK(broadcasts >= 1);
    CHECK(allStopped());
    CHECK(bench.hw->write(t0, dt) == ReturnType::ERROR);
  }
  resetDrives();
  {
    ActiveBench bench;
    startMoving(bench);
    drives[2].stuck_running = true;
    CHECK(bench.hw->on_deactivate(lifecycle_state) == CallbackReturn::ERROR);
    CHECK(broadcasts >= 2);  // retried until the deadline
    CHECK(bench.hw->write(t0, dt) == ReturnType::ERROR);  // stop latched
    drives[2].stuck_running = false;
    CHECK(bench.hw->on_deactivate(lifecycle_state) == CallbackReturn::SUCCESS);
    CHECK(allStopped());
  }
}

void testShutdownAndErrorStop()
{
  for (bool error : {false, true}) {
    resetDrives();
    ActiveBench bench;
    startMoving(bench);
    const auto r = error ? bench.hw->on_error(lifecycle_state) :
      bench.hw->on_shutdown(lifecycle_state);
    CHECK(r == CallbackReturn::SUCCESS);
    CHECK(broadcasts >= 1);
    CHECK(allStopped());
  }
}

}  // namespace

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  testDisabledRefusesAsToday();
  testBenchParameterRefusals();
  testConfigureRefusals();
  testActivationSequence();
  testPolePairsMismatchRefusesAndStopsAll();
  testMotionConversionAndChangeOnlyWrites();
  testFaultBroadcastsStop();
  testLossBroadcastsStop();
  testLossByFailedWritesBroadcastsStop();
  testFailedDirectionWriteStopsAll();
  testFailedSpeedPollsStopAll();
  testOneFailedSpeedPollRecovers();
  testSpeedFreshnessResetsOnActivation();
  testFailedFaultPollsStopAll();
  testOneFailedFaultPollRecovers();
  testFaultFreshnessResetsOnActivation();
  testControlModeReadBack();
  testSpeedZeroWriteFailureRefuses();
  testDeactivateBroadcastsAndConfirms();
  testShutdownAndErrorStop();

  // Nothing, in any test, ever wrote the baud, address or save register.
  for (const auto & w : all_writes) {
    CHECK(w.address != 0x00F6 && w.address != 0x00A6 && w.address != 0x80FF);
  }
  CHECK(!all_writes.empty());
  rclcpp::shutdown();
  std::cout << "bench motion mock tests passed (" << all_writes.size() << " writes checked)\n";
}
