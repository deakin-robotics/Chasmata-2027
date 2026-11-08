#include "rover_drivetrain_control/bld305s_driver.hpp"
#include "rover_drivetrain_control/diagnostic_probe.hpp"
#include <modbus/modbus.h>
#include <array>
#include <stdexcept>
#define CHECK(e) do { if (!(e)) throw std::runtime_error(#e); } while(false)
#include <cerrno>
#include <cstdint>
#include <iostream>
#include <map>
#include <string>

struct _modbus {
  int slave{0};
  bool connected{false};
};

static _modbus * shared_context{nullptr};
static unsigned contexts_created{0};
static std::array<bool, 5> fail_slave{};
static std::array<unsigned, 5> read_attempts{};
static int last_read_address{-1};
static unsigned bus_calls{0};    // slave selects, reads and writes
static unsigned write_calls{0};  // function code 06
static std::map<int, std::uint16_t> register_values;  // per-address override
static int broadcast_errno{ETIMEDOUT};  // what libmodbus reports for a write to address 0
static int last_write_slave{-1};
static int last_write_address{-1};
static std::uint16_t last_write_value{0xFFFF};
extern "C" {
modbus_t * modbus_new_rtu(const char *, int, char, int, int)
{
  CHECK(shared_context == nullptr);
  ++contexts_created;
  shared_context = new _modbus;
  return shared_context;
}
int modbus_set_response_timeout(modbus_t *, std::uint32_t, std::uint32_t) {return 0;}
int modbus_connect(modbus_t * m) {m->connected=true;return 0;}
void modbus_close(modbus_t * m) {m->connected=false;}
void modbus_free(modbus_t * m) {CHECK(m==shared_context);delete m;shared_context=nullptr;}
int modbus_set_slave(modbus_t * m, int slave)
{
  CHECK(m==shared_context && m->connected);
  CHECK(slave>=0 && slave<=4);  // 0 = broadcast
  ++bus_calls;
  m->slave=slave;
  return 0;
}
int modbus_read_registers(modbus_t * m, int addr, int n, std::uint16_t * out)
{
  CHECK(m==shared_context && m->connected);
  ++bus_calls;
  ++read_attempts[m->slave];
  last_read_address=addr;
  if (fail_slave[m->slave]) {errno=ETIMEDOUT;return -1;}
  const auto it=register_values.find(addr);
  *out=it!=register_values.end() ? it->second : static_cast<std::uint16_t>(100+m->slave);
  return n;
}
int modbus_write_register(modbus_t * m, int addr, const std::uint16_t value)
{
  CHECK(m==shared_context && m->connected);
  ++bus_calls;
  ++write_calls;
  last_write_slave=m->slave; last_write_address=addr; last_write_value=value;
  if (m->slave==0) {
    // Drives never answer address 0; libmodbus 3.1.10 still waits and times out.
    if (broadcast_errno!=0) {errno=broadcast_errno;return -1;}
    return 1;
  }
  if (fail_slave[m->slave]) {errno=ETIMEDOUT;return -1;}
  return 1;
}
}

using Driver = rover_drivetrain_control::Bld305sDriver;
using rover_drivetrain_control::diagnostics::findProbeSelector;
using rover_drivetrain_control::diagnostics::readProbe;

// One probe read: function code 03 at the manual address, raw value returned
// unconverted, no write, and the expected manual meaning in the detail.
static void checkProbe(
  Driver & driver, std::uint8_t selector, int address, std::uint16_t raw,
  const std::string & expected_detail)
{
  register_values[address]=raw;
  const auto writes_before=write_calls;
  const auto read=readProbe(driver,2,selector);
  CHECK(read && read->result.ok());
  CHECK(last_read_address==address);
  CHECK(read->raw_value==raw);
  CHECK(write_calls==writes_before);
  CHECK(read->detail.find(expected_detail)!=std::string::npos);
  register_values.erase(address);
}

static void testProbeSelectors(Driver & driver)
{
  // Existing selectors keep their registers.
  checkProbe(driver,1,0x0096,321,"= 321 (0x0141)");
  checkProbe(driver,2,0x00B6,12,"= 12 (0x000C)");
  checkProbe(driver,3,0x00C6,240,"= 240 (0x00F0)");

  // 4: drive address
  checkProbe(driver,4,0x00A6,2,"matches requested slave ID");
  checkProbe(driver,4,0x00A6,7,"differs from requested slave ID 2");

  // 5: baud code
  checkProbe(driver,5,0x00F6,0x01,"9600 baud");
  checkProbe(driver,5,0x00F6,0x04,"38400 baud");
  checkProbe(driver,5,0x00F6,0x0C,"code not listed in manual");

  // 6: fault code
  checkProbe(driver,6,0x0076,1,"manual: overcurrent");
  checkProbe(driver,6,0x0076,8,"manual: stalled");
  checkProbe(driver,6,0x0076,7,"no meaning listed in manual");

  // 7: running status
  checkProbe(driver,7,0x0066,0,"manual: stop");
  checkProbe(driver,7,0x0066,1,"manual: forward");
  checkProbe(driver,7,0x0066,2,"manual: reverse");
  checkProbe(driver,7,0x0066,3,"manual: brake");

  // 8: actual speed stays raw (manual example 0x0BB8), never converted.
  checkProbe(driver,8,0x005F,0x0BB8,"= 3000 (0x0BB8): raw");

  // 9: motor pole pairs (manual default 5)
  checkProbe(driver,9,0x0116,5,"= 5 (0x0005): matches manual default of 5");
  checkProbe(driver,9,0x0116,2,"= 2 (0x0002): differs from manual default of 5");

  // 10: control mode
  checkProbe(driver,10,0x0136,1,"manual: internal");
  checkProbe(driver,10,0x0136,0,"manual: external");
  checkProbe(driver,10,0x0136,4,"no meaning listed in manual");

  // A failed read reports no value and still writes nothing.
  fail_slave[2]=true;
  const auto writes_before=write_calls;
  const auto failed=readProbe(driver,2,6);
  CHECK(failed && !failed->result.ok());
  CHECK(failed->raw_value==0);
  CHECK(write_calls==writes_before);
  fail_slave[2]=false;

  // Any other selector is rejected before any bus exchange.
  for (int selector : {0, 11, 128, 255}) {
    const auto calls_before=bus_calls;
    CHECK(findProbeSelector(static_cast<std::uint8_t>(selector))==nullptr);
    CHECK(!readProbe(driver,1,static_cast<std::uint8_t>(selector)));
    CHECK(bus_calls==calls_before);
  }
  CHECK(write_calls==0);
}

// Broadcast stop: address 0, 0x0066 = 0. No drive replies to a broadcast, so
// the timeout libmodbus reports counts as sent. A real send error does not.
static void testBroadcastStop(Driver & driver, const Driver::SlaveIds & ids)
{
  broadcast_errno=ETIMEDOUT;
  auto r=driver.broadcastStop();
  CHECK(r.ok());
  CHECK(last_write_slave==0 && last_write_address==0x0066 && last_write_value==0);

  // If a drive did reply (libmodbus quirk mode), that is also sent.
  broadcast_errno=0;
  CHECK(driver.broadcastStop().ok());

  // Any other error means it may not have gone out.
  broadcast_errno=EIO;
  r=driver.broadcastStop();
  CHECK(r.code==Driver::ErrorCode::MODBUS_ERROR && r.system_errno==EIO);
  broadcast_errno=ETIMEDOUT;

  // The next unicast exchange addresses its own drive again, not address 0.
  std::uint16_t value=0;
  CHECK(driver.readFaultRaw(2,value).ok());
  CHECK(value==102);

  // A broadcast timeout inside a cycle is not a missed exchange for any drive.
  CHECK(driver.beginCycle(ids).ok());
  CHECK(driver.broadcastStop().ok());
  for (auto id : ids) {  // the default three mandatory exchanges per drive
    CHECK(driver.readFaultRaw(id,value).ok());
    CHECK(driver.readTemperatureRaw(id,value).ok());
    CHECK(driver.readCurrentRaw(id,value).ok());
  }
  CHECK(driver.endCycle().ok());
  for (auto id : ids) CHECK(driver.consecutiveFailures(id)==0);

  // A broadcast is refused, not sent, while the bus is closed.
  Driver::RtuConfig closed_cfg;
  closed_cfg.device="mock-closed"; closed_cfg.baud_rate=9600; closed_cfg.parity='N';
  closed_cfg.data_bits=8; closed_cfg.stop_bits=1;
  Driver closed(closed_cfg);
  const auto before=write_calls;
  CHECK(closed.broadcastStop().code==Driver::ErrorCode::NOT_CONNECTED);
  CHECK(write_calls==before);
}

int main()
{
  const Driver::SlaveIds ids{1,2,3,4};
  Driver::RtuConfig cfg;
  cfg.device="mock"; cfg.baud_rate=38400; cfg.parity='N';
  cfg.data_bits=8; cfg.stop_bits=1;
  Driver driver(cfg);
  CHECK(driver.open().ok());
  CHECK(contexts_created==1);
  CHECK(driver.beginCycle({1,2,3,3}).code==Driver::ErrorCode::INVALID_CYCLE_STATE);
  CHECK(driver.beginCycle({0,2,3,4}).code==Driver::ErrorCode::INVALID_CYCLE_STATE);
  CHECK(driver.beginCycle({1,2,3,248}).code==Driver::ErrorCode::INVALID_CYCLE_STATE);
  CHECK(!driver.allSlavesLost({1,2,3,3}));

  std::uint16_t value=0;
  auto read_good = [&](std::uint8_t id) {
      CHECK(driver.readTemperatureRaw(id,value).ok());
      CHECK(value==100+id);  // verifies the selected slave for each transaction
      CHECK(driver.readCurrentRaw(id,value).ok());
      CHECK(driver.readVoltageRaw(id,value).ok());
    };
  // One timeout skips only the failed slave; all three peers stay healthy.
  fail_slave[1]=true;
  for (unsigned cycle=1;cycle<=3;++cycle) {
    CHECK(driver.beginCycle(ids).ok());
    CHECK(driver.beginCycle(ids).code==Driver::ErrorCode::INVALID_CYCLE_STATE);
    const auto before=read_attempts[1];
    CHECK(!driver.readTemperatureRaw(1,value).ok());
    CHECK(driver.readCurrentRaw(1,value).code==Driver::ErrorCode::SKIPPED_THIS_CYCLE);
    CHECK(driver.writeSpeedRaw(1,0).code==Driver::ErrorCode::SKIPPED_THIS_CYCLE);
    CHECK(read_attempts[1]==before+1);
    for (std::uint8_t id=2;id<=4;++id) read_good(id);
    CHECK(driver.endCycle().ok());
    CHECK(driver.consecutiveFailures(1)==cycle);
    CHECK(!driver.telemetryValid(1));
    CHECK(!driver.allSlavesLost(ids));
    for (std::uint8_t id=2;id<=4;++id) {
      CHECK(driver.consecutiveFailures(id)==0);
      CHECK(driver.communicationState(id)==Driver::CommunicationState::HEALTHY);
      CHECK(driver.telemetryValid(id));
    }
  }
  CHECK(driver.communicationState(1)==Driver::CommunicationState::LOST);
  CHECK(driver.controllerState(1)==Driver::ControllerState::UNKNOWN);
  fail_slave[1]=false;
  CHECK(driver.beginCycle({4,2,1,3}).ok());  // wheel mapping order is configurable
  for (auto id : ids) read_good(id);
  CHECK(driver.endCycle().ok());
  CHECK(driver.telemetryValid(1));
  CHECK(driver.communicationState(1)==Driver::CommunicationState::HEALTHY);
  CHECK(driver.controllerState(1)==Driver::ControllerState::UNKNOWN);

  // Diagnostics probe selectors, outside any cycle.
  testProbeSelectors(driver);
  testBroadcastStop(driver, ids);

  // Exercise failures for a drive that used to be on the other adapter.
  fail_slave[3]=true;
  for (unsigned cycle=1;cycle<=3;++cycle) {
    CHECK(driver.beginCycle(ids).ok());
    for (auto id : ids) {
      if (id==3) {
        CHECK(!driver.readTemperatureRaw(id,value).ok());
        CHECK(driver.readCurrentRaw(id,value).code==Driver::ErrorCode::SKIPPED_THIS_CYCLE);
      } else {
        read_good(id);
      }
    }
    CHECK(driver.endCycle().ok());
    CHECK(driver.consecutiveFailures(3)==cycle);
    CHECK(driver.telemetryValid(3)==(cycle==1));
    CHECK(driver.communicationState(3)==(cycle<3 ?
      Driver::CommunicationState::DEGRADED : Driver::CommunicationState::LOST));
    CHECK(!driver.allSlavesLost(ids));
  }

  // Missing work for any of the four drives counts as a missed cycle.
  fail_slave[3]=false;
  CHECK(driver.beginCycle(ids).ok());
  for (std::uint8_t id=1;id<=3;++id) read_good(id);
  CHECK(driver.endCycle().ok());
  CHECK(driver.consecutiveFailures(4)==1);
  CHECK(driver.communicationState(4)==Driver::CommunicationState::DEGRADED);

  // Correlated silence requires all four drives, not just one side.
  for (auto id : ids) fail_slave[id]=true;
  for (int cycle=0;cycle<3;++cycle) {
    CHECK(driver.beginCycle(ids).ok());
    for (auto id : ids) CHECK(!driver.readTemperatureRaw(id,value).ok());
    CHECK(driver.endCycle().ok());
  }
  CHECK(driver.allSlavesLost(ids));
  CHECK(contexts_created==1);
  driver.close();
  CHECK(shared_context==nullptr);
  std::cout<<"mock shared-bus four-drive per-cycle tests passed\n";
}
